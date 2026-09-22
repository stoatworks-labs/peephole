/**
 * Peephole's desktop shell.
 *
 * The renderer is the same React app the hosted site serves. What this process
 * adds is the three things a browser tab cannot do well:
 *
 *  * **A real origin.** The page is served over a registered `app://` scheme
 *    rather than `file://`, so it is a secure origin with a stable identity:
 *    `getUserMedia` works, `enumerateDevices()` returns labels, and the
 *    remembered device and mode survive a restart. A `file://` page is an
 *    opaque origin and loses all three.
 *  * **The screen stays on properly.** `powerSaveBlocker` holds the display
 *    awake for as long as a picture is up. The web Screen Wake Lock API is
 *    dropped whenever the tab is hidden and does not exist in Firefox at all.
 *  * **It is offline, and provably so.** Every http/https/ws request from the
 *    renderer is cancelled, and only the camera permission is ever granted.
 *
 * There is no auto-updater, no telemetry and no network code path of any kind.
 */
import {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  net,
  powerSaveBlocker,
  protocol,
  session,
  shell,
  systemPreferences,
  type MenuItemConstructorOptions,
} from 'electron'
import { existsSync } from 'node:fs'
import { join, normalize, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const isMac = process.platform === 'darwin'

/** The built renderer, which sits next to this file in `out/`. */
const RENDERER_DIR = normalize(join(__dirname, '..', 'renderer'))

/**
 * `standard: true` is what makes this a real origin rather than an opaque one —
 * without it there is no `app://peephole` to hang a camera permission or a
 * localStorage bucket on. `secure: true` puts it in the same trust bucket as
 * https, which is what `getUserMedia` requires.
 *
 * This must run before `app.whenReady()`; Electron will not register a
 * privileged scheme afterwards.
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, codeCache: true },
  },
])

app.setName('Peephole')
// Windows groups taskbar buttons and toast notifications by this, and without
// it a packaged app is grouped under "electron.app.Electron".
app.setAppUserModelId('com.allansargeant.peephole')

let mainWindow: BrowserWindow | null = null
let displayBlocker: number | null = null

/** Serve the built renderer from RENDERER_DIR, and nothing else from anywhere. */
function serveRenderer(): void {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url)
    const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname)
    const file = normalize(join(RENDERER_DIR, rel))

    // `..` in a request must not escape the bundle. Nothing in this app can
    // produce such a URL, but the handler is the only thing standing between a
    // URL and the filesystem, so it checks rather than assumes.
    if (file !== RENDERER_DIR && !file.startsWith(RENDERER_DIR + sep)) {
      return new Response('Forbidden', { status: 403 })
    }

    try {
      return await net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

/**
 * Camera, and nothing else.
 *
 * Electron grants every permission a page asks for unless a handler says
 * otherwise. This app needs exactly one — video capture — so everything else is
 * refused, including the microphone: `constraintsFor()` always passes
 * `audio: false`, so a request for it could only come from something that is
 * not this app.
 */
function lockDownPermissions(ses: Electron.Session): void {
  const fromRenderer = (url: string): boolean => url.startsWith('app://')

  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!fromRenderer(contents.getURL())) return callback(false)
    if (permission === 'media') {
      const types = (details as { mediaTypes?: string[] }).mediaTypes ?? []
      return callback(types.length > 0 && types.every((t) => t === 'video'))
    }
    callback(permission === 'fullscreen')
  })

  ses.setPermissionCheckHandler((_contents, permission, origin, details) => {
    if (!fromRenderer(origin)) return false
    if (permission === 'media') {
      return (details as { mediaType?: string }).mediaType !== 'audio'
    }
    return permission === 'fullscreen'
  })

  // WebUSB, serial, HID, Bluetooth. Denied outright: a UVC camera reaches this
  // app through getUserMedia, never through a device-picker API.
  ses.setDevicePermissionHandler(() => false)

  /**
   * The offline guarantee, enforced rather than asserted.
   *
   * Every asset the app needs is inside the bundle and arrives over `app://`,
   * which these patterns do not match. So anything cancelled here is by
   * definition something that should not have been asked for, and the log line
   * is how it would be noticed.
   */
  ses.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    (details, callback) => {
      console.warn(`[peephole] blocked an outbound request: ${details.url}`)
      callback({ cancel: true })
    },
  )
}

/** Links (the About dialog's) open in the user's browser, never in this window. */
function keepNavigationOut(contents: Electron.WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (url.startsWith('app://')) return
    event.preventDefault()
    if (url.startsWith('https://')) void shell.openExternal(url)
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 760,
    minWidth: 480,
    minHeight: 320,
    // The app is a monitor, and its page is near-black. Without this the window
    // is white for the moment before the first paint, which in a dark room is a
    // torch pointed at the operator.
    backgroundColor: '#07090c',
    show: false,
    autoHideMenuBar: true,
    title: 'Peephole',
    icon: linuxIcon(),
    webPreferences: {
      preload: join(__dirname, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      // The renderer runs in Chromium's own sandbox. It can, because the
      // preload needs nothing from Node beyond `ipcRenderer`, `contextBridge`
      // and `process.platform`, all of which a sandboxed preload still has.
      // Most Electron apps turn this off for a preload that wants `fs`; this
      // one has no reason to.
      sandbox: true,
      spellcheck: false,
      // A confidence monitor is usually the window you are NOT looking at.
      // Chromium throttles timers and rendering in an occluded window, which
      // would stall the idle-cursor timer and can stall the video element
      // itself — exactly the failure the hosted version has to work around
      // when a tab is hidden.
      backgroundThrottling: false,
    },
  })

  win.once('ready-to-show', () => win.show())
  keepNavigationOut(win.webContents)

  // The renderer draws its own chrome differently in full screen, and on the
  // desktop the window manager can take the app in and out of it without the
  // page being told.
  win.on('enter-full-screen', () => win.webContents.send('peephole:fullscreen', true))
  win.on('leave-full-screen', () => win.webContents.send('peephole:fullscreen', false))

  void win.loadURL('app://peephole/index.html')
  return win
}

/**
 * Linux window managers take the taskbar icon from the BrowserWindow rather
 * than from the .desktop entry, so the icon is shipped as an extra resource
 * and pointed at here. macOS and Windows read it from the bundle instead.
 */
function linuxIcon(): string | undefined {
  if (process.platform !== 'linux') return undefined
  const packaged = join(process.resourcesPath, 'icon.png')
  if (existsSync(packaged)) return packaged
  const local = join(__dirname, '..', '..', 'build', 'icon.png')
  return existsSync(local) ? local : undefined
}

/**
 * The shared Stoatworks About dialog, which the page already carries.
 *
 * It is opened by clicking anything marked `data-stoatworks-about`. The UI
 * carries one, under the start card — but only there, because once there is a
 * picture the card is gone and the only chrome left is the control bar, which
 * is the picture's and not the application's. A menu item is where an
 * application keeps its About and is reachable whatever is on screen, so the
 * menu calls the dialog's own global directly rather than synthesising a click
 * on an element that is not always in the DOM.
 */
const showAbout = (): void => {
  void mainWindow?.webContents.executeJavaScript('window.stoatworksAbout?.open()')
}

function buildMenu(): void {
  const about: MenuItemConstructorOptions = { label: 'About Peephole', click: showAbout }

  const template: MenuItemConstructorOptions[] = [
    // Hand-built rather than `role: 'appMenu'` so that About is this app's own
    // dialog — with the version, the licence and where to report a bug — and
    // not the system panel, which would leave macOS the one platform showing
    // something different.
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              about,
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          } as MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'View',
      submenu: [
        {
          label: 'Full Screen',
          accelerator: isMac ? 'Control+Command+F' : 'F11',
          click: () => mainWindow?.setFullScreen(!mainWindow.isFullScreen()),
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'toggleDevTools' },
      ],
    },
    { role: 'windowMenu' },
    ...(isMac ? [] : [{ role: 'help', submenu: [about] } as MenuItemConstructorOptions]),
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc(): void {
  /**
   * Returns nothing on purpose. On macOS entering full screen is animated, so
   * `isFullScreen()` immediately afterwards still reports the old value — a
   * return value here would be wrong about half the time and the page would
   * believe it. The truth arrives as the window's own enter/leave-full-screen
   * event, which is also the only thing that fires when the window manager
   * does it without the page being involved.
   */
  ipcMain.handle('peephole:set-fullscreen', (event, on: unknown) => {
    BrowserWindow.fromWebContents(event.sender)?.setFullScreen(Boolean(on))
  })

  ipcMain.handle('peephole:is-fullscreen', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false
  })

  /**
   * `prevent-display-sleep` rather than `prevent-app-suspension`: the point is
   * the screen, not the process. Held for as long as a picture is up and
   * dropped on stop, so an idle Peephole does not keep a laptop awake.
   */
  ipcMain.handle('peephole:keep-awake', (_event, on: unknown) => {
    if (on) {
      if (displayBlocker === null || !powerSaveBlocker.isStarted(displayBlocker)) {
        displayBlocker = powerSaveBlocker.start('prevent-display-sleep')
      }
    } else if (displayBlocker !== null) {
      if (powerSaveBlocker.isStarted(displayBlocker)) powerSaveBlocker.stop(displayBlocker)
      displayBlocker = null
    }
    return displayBlocker !== null
  })

  /**
   * macOS and Windows both gate the camera behind an OS-level grant that is
   * separate from anything the page does, and a refusal there surfaces inside
   * getUserMedia as a bare NotAllowedError — indistinguishable from a page-level
   * block, and pointing the user at the wrong place. Asking the OS directly is
   * what lets the renderer say "System Settings" instead of "the padlock".
   */
  ipcMain.handle('peephole:camera-status', () => {
    if (isMac || process.platform === 'win32') {
      return systemPreferences.getMediaAccessStatus('camera')
    }
    return 'unknown'
  })

  ipcMain.handle('peephole:request-camera', async () => {
    // askForMediaAccess exists on macOS only. Windows has no prompt to raise:
    // the setting is in Settings ▸ Privacy, and the renderer says so.
    if (!isMac) return true
    return systemPreferences.askForMediaAccess('camera')
  })
}

// A second copy would fight the first for the capture device and lose with a
// NotReadableError, which reads as "the card is broken" rather than "it is
// already open in the other window".
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    serveRenderer()
    lockDownPermissions(session.defaultSession)
    registerIpc()
    buildMenu()

    mainWindow = createWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        mainWindow = createWindow()
        mainWindow.on('closed', () => {
          mainWindow = null
        })
      }
    })
  })

  app.on('window-all-closed', () => {
    if (!isMac) app.quit()
  })

  // A blocker outliving the app would keep the display awake with nothing on
  // screen, and only a reboot would clear it.
  app.on('will-quit', () => {
    if (displayBlocker !== null && powerSaveBlocker.isStarted(displayBlocker)) {
      powerSaveBlocker.stop(displayBlocker)
    }
    displayBlocker = null
  })
}
