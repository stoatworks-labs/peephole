/**
 * The page's half of the desktop bridge.
 *
 * The same `src/` builds the hosted site and the Electron renderer, so nothing
 * here may assume it is in an app: `getDesktop()` returns null in a browser and
 * every caller keeps its web behaviour. What the bridge buys, when it is there:
 *
 *  * **Real window full screen** instead of the Fullscreen API, which on the
 *    desktop would leave the window's own chrome around the picture.
 *  * **A power-save blocker** instead of the Screen Wake Lock API, which
 *    Firefox does not have and which every browser drops when the tab hides.
 *  * **The OS's answer about the camera.** macOS and Windows gate it behind a
 *    system setting, and a refusal there arrives inside getUserMedia as a bare
 *    NotAllowedError — the same error a browser gives for a page-level block,
 *    which is why the hosted version's advice ("the padlock in the address
 *    bar") is exactly wrong in an app.
 *
 * See `electron/preload/index.ts` for the other half.
 */

export type Platform = 'darwin' | 'win32' | 'linux' | 'unknown'

/** What the OS says about camera access. 'unknown' is every platform but macOS and Windows. */
export type CameraStatus = 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'

/** The shape the preload exposes. Tokens rather than closures — see the preload. */
type RawBridge = {
  platform: unknown
  setFullScreen(on: boolean): Promise<void>
  isFullScreen(): Promise<boolean>
  onFullScreenChange(callback: (on: boolean) => void): number
  offFullScreenChange(token: number): void
  keepDisplayAwake(on: boolean): Promise<boolean>
  cameraStatus(): Promise<string>
  requestCameraAccess(): Promise<boolean>
}

export type Desktop = {
  platform: Platform
  /**
   * Asks the window to go in or out of full screen. It does not report the
   * result: on macOS the change is animated and has not happened yet when this
   * resolves. `onFullScreenChange` is the authoritative answer, and the only
   * one that also fires when the window manager does it by itself.
   */
  setFullScreen(on: boolean): Promise<void>
  isFullScreen(): Promise<boolean>
  /** Returns an unsubscribe function, so it drops straight into a useEffect. */
  onFullScreenChange(callback: (on: boolean) => void): () => void
  keepDisplayAwake(on: boolean): Promise<boolean>
  cameraStatus(): Promise<CameraStatus>
  requestCameraAccess(): Promise<boolean>
}

const METHODS = [
  'setFullScreen',
  'isFullScreen',
  'onFullScreenChange',
  'offFullScreenChange',
  'keepDisplayAwake',
  'cameraStatus',
  'requestCameraAccess',
] as const

const PLATFORMS: Platform[] = ['darwin', 'win32', 'linux']

const STATUSES: CameraStatus[] = ['granted', 'denied', 'restricted', 'not-determined', 'unknown']

/**
 * The desktop bridge, or null in a browser.
 *
 * A bridge missing any of its methods is treated as no bridge at all. That can
 * only happen if a packaged app's preload and renderer came from different
 * builds, and half a bridge would fail later, somewhere less obvious, with the
 * page already claiming desktop behaviour it does not have.
 */
export function getDesktop(
  scope: unknown = typeof window === 'undefined' ? undefined : window,
): Desktop | null {
  const raw = (scope as { peephole?: unknown } | undefined)?.peephole as RawBridge | undefined
  if (!raw) return null
  if (!METHODS.every((m) => typeof raw[m] === 'function')) return null

  const platform = PLATFORMS.find((p) => p === raw.platform) ?? 'unknown'

  return {
    platform,
    setFullScreen: (on) => raw.setFullScreen(on),
    isFullScreen: () => raw.isFullScreen(),
    onFullScreenChange: (callback) => {
      const token = raw.onFullScreenChange(callback)
      return () => raw.offFullScreenChange(token)
    },
    keepDisplayAwake: (on) => raw.keepDisplayAwake(on),
    cameraStatus: async () => {
      const status = await raw.cameraStatus()
      return STATUSES.find((s) => s === status) ?? 'unknown'
    },
    requestCameraAccess: () => raw.requestCameraAccess(),
  }
}

/**
 * Where to go when the camera is refused.
 *
 * In a browser that means the page's own permission; in an app it is always the
 * operating system, and each one keeps it somewhere different. Sending someone
 * to the address bar of an application that has no address bar is the single
 * most likely way for this app to look broken when it is not.
 */
export function blockedHint(platform: Platform | null): string {
  switch (platform) {
    case 'darwin':
      return 'macOS is blocking it. Open System Settings ▸ Privacy & Security ▸ Camera, switch Peephole on, then press Start again.'
    case 'win32':
      return 'Windows is blocking it. Open Settings ▸ Privacy & security ▸ Camera, make sure "Let desktop apps access your camera" is on, then press Start again.'
    case 'linux':
      return 'The system refused access to the device. Check that your user is in the "video" group and that nothing else has the camera open, then press Start again.'
    case 'unknown':
      return 'The system refused access to the camera. Grant it in your privacy settings, then press Start again.'
    default:
      return 'Allow camera access for this site — the padlock in the address bar — then press Start again.'
  }
}

/** The fine print under Start: what is about to be asked for, and by whom. */
export function startNote(platform: Platform | null): string {
  if (platform === null) {
    return 'The browser will ask for camera access. Device names stay hidden until it is granted — that is the browser, not this page.'
  }
  if (platform === 'darwin' || platform === 'win32') {
    return 'The system will ask for camera access the first time. Device names stay hidden until it is granted — that is the operating system, not this app. Nothing is recorded, and there is no network code in this app at all.'
  }
  return 'Device names stay hidden until access is granted. Nothing is recorded, and there is no network code in this app at all.'
}
