/**
 * The whole surface the desktop shell offers the page, and no more.
 *
 * The renderer is the same code the hosted site runs, so this bridge is the
 * only thing that can tell it it is not in a tab. It carries four capabilities
 * a browser cannot give it and nothing else — no filesystem, no shell, no
 * `ipcRenderer`. `src/lib/desktop.ts` is the other half.
 */
import { contextBridge, ipcRenderer } from 'electron'

/**
 * Full-screen subscribers are held here and handed out as numeric tokens.
 *
 * Only primitives cross the context bridge in the return direction with
 * certainty, so `onFullScreenChange` deliberately does not hand back an
 * unsubscribe closure; `src/lib/desktop.ts` turns the token into one.
 */
const listeners = new Map<number, (on: boolean) => void>()
let nextToken = 1

ipcRenderer.on('peephole:fullscreen', (_event, on: boolean) => {
  for (const listener of listeners.values()) listener(Boolean(on))
})

contextBridge.exposeInMainWorld('peephole', {
  platform: process.platform,

  /** Asks; it does not report. The answer comes back on the full-screen event. */
  setFullScreen: (on: boolean): Promise<void> =>
    ipcRenderer.invoke('peephole:set-fullscreen', Boolean(on)),

  isFullScreen: (): Promise<boolean> => ipcRenderer.invoke('peephole:is-fullscreen'),

  onFullScreenChange: (callback: (on: boolean) => void): number => {
    const token = nextToken++
    listeners.set(token, callback)
    return token
  },

  offFullScreenChange: (token: number): void => {
    listeners.delete(token)
  },

  /** Holds the display awake through powerSaveBlocker. Resolves to whether it is held. */
  keepDisplayAwake: (on: boolean): Promise<boolean> =>
    ipcRenderer.invoke('peephole:keep-awake', Boolean(on)),

  /** The OS-level camera grant: 'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'. */
  cameraStatus: (): Promise<string> => ipcRenderer.invoke('peephole:camera-status'),

  /** Raises the OS prompt where there is one (macOS). Resolves to whether access is now allowed. */
  requestCameraAccess: (): Promise<boolean> => ipcRenderer.invoke('peephole:request-camera'),
})
