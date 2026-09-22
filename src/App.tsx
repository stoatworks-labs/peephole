import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  actualOf,
  constraintsFor,
  describe,
  isDownscaled,
  listVideoInputs,
  modesFromCapabilities,
  stopStream,
  type Actual,
  type Device,
  type Mode,
} from './lib/devices'
import { blockedHint, getDesktop, startNote, type Platform } from './lib/desktop'
import { chooseDevice, loadSettings, nextRotation, saveSettings, transformFor, type Settings } from './lib/view'
import { createWakeLock } from './lib/wakelock'

type Status =
  | { kind: 'idle' }
  | { kind: 'starting' }
  | { kind: 'live' }
  | { kind: 'error'; message: string; hint?: string }

/**
 * getUserMedia's errors, in words that say what to do about them.
 *
 * `platform` is null in a browser and the OS's name in the desktop app. It only
 * changes where the user is sent, but that is the difference between advice
 * that works and advice that names a control the app does not have.
 */
function explain(err: unknown, platform: Platform | null): { message: string; hint?: string } {
  const e = err as { name?: string; message?: string }
  switch (e?.name) {
    case 'NotAllowedError':
      return {
        message: platform
          ? 'Access to the camera was blocked.'
          : 'The browser blocked access to the camera.',
        hint: blockedHint(platform),
      }
    case 'NotFoundError':
    case 'OverconstrainedError':
      return {
        message: 'That device is no longer there.',
        hint: 'It may have been unplugged, or claimed by another application. Pick another device.',
      }
    case 'NotReadableError':
      return {
        message: 'The device is there but would not open.',
        hint: 'Something else usually has it: OBS, Teams, Zoom, or another tab of this page. Close that and try again.',
      }
    case 'SecurityError':
      return {
        message: 'Cameras are only available on a secure page.',
        hint: 'Open this over https, or on localhost.',
      }
    default:
      return { message: e?.message || 'The camera could not be started.' }
  }
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [devices, setDevices] = useState<Device[]>([])
  const [deviceId, setDeviceId] = useState<string | undefined>(settings.deviceId)
  const [modes, setModes] = useState<Mode[]>([])
  const [mode, setMode] = useState<Mode | undefined>(
    settings.width && settings.height
      ? { width: settings.width, height: settings.height, fps: settings.fps }
      : undefined,
  )
  const [actual, setActual] = useState<Actual | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [fullscreen, setFullscreen] = useState(false)
  const [idle, setIdle] = useState(false)
  const [box, setBox] = useState({ w: 0, h: 0 })

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  // start() needs the remembered label without taking `settings` as a
  // dependency, which would rebuild it on every mirror or rotate.
  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // null in a browser tab; the Electron shell's bridge in the desktop app.
  const desktop = useMemo(() => getDesktop(), [])
  const platform = desktop?.platform ?? null
  const wakeLock = useMemo(() => createWakeLock(undefined, undefined, desktop), [desktop])

  const live = status.kind === 'live'

  // ---- starting and stopping -------------------------------------------

  const start = useCallback(
    async (wantedId?: string, wantedMode?: Mode) => {
      setStatus({ kind: 'starting' })
      stopStream(streamRef.current)
      streamRef.current = null
      try {
        // On macOS the OS grant is a separate gate in front of the browser's
        // own, and asking for it explicitly is what raises the system prompt at
        // a moment the user is expecting one. Without this the first Start can
        // fail with a bare NotAllowedError and no prompt ever appearing.
        if (desktop && (await desktop.cameraStatus()) === 'not-determined') {
          await desktop.requestCameraAccess()
        }

        let stream: MediaStream
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraintsFor(wantedId, wantedMode))
        } catch (err) {
          // A remembered deviceId stops matching anything the moment the site's
          // camera permission is reset — the ids are rotated. Asking again for
          // any camera turns that from an error card into a picture, and the
          // device is then matched back by label below.
          const name = (err as { name?: string })?.name
          if (wantedId && (name === 'OverconstrainedError' || name === 'NotFoundError')) {
            stream = await navigator.mediaDevices.getUserMedia(constraintsFor(undefined, wantedMode))
          } else {
            throw err
          }
        }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play().catch(() => {
            /* autoplay policies allow muted playback; a rejection here is not fatal */
          })
        }
        const got = actualOf(stream)
        setActual(got)
        setStatus({ kind: 'live' })
        void wakeLock.acquire()

        // Labels are blank until a stream exists, so the list is only worth
        // building now — and it is rebuilt on every start so a device plugged
        // in since the last one appears.
        const found = await listVideoInputs()
        setDevices(found)
        let chosen = got?.deviceId ?? wantedId
        setDeviceId(chosen)

        // If the fallback above landed on a different camera, the remembered
        // label is the only thing left that says which one was wanted. Switch
        // to it once — guarded by `chosen`, so this cannot ping-pong.
        if (wantedId && got?.deviceId && got.deviceId !== wantedId) {
          const wanted = chooseDevice(found, { label: settingsRef.current.label })
          if (wanted && wanted.deviceId !== chosen) {
            chosen = wanted.deviceId
            setDeviceId(chosen)
            void start(chosen, wantedMode)
            return
          }
        }

        const track = stream.getVideoTracks()[0]
        setModes(modesFromCapabilities(track?.getCapabilities?.()))

        // A stream that ends on its own (card unplugged, another app taking
        // it) leaves a frozen last frame otherwise, which reads as "working".
        track?.addEventListener('ended', () => {
          setStatus({
            kind: 'error',
            message: 'The device stopped.',
            hint: 'It was unplugged, or another application took it. Press Start to pick it up again.',
          })
          setActual(null)
        })
      } catch (err) {
        const { message, hint } = explain(err, platform)
        setStatus({ kind: 'error', message, hint })
        setActual(null)
      }
    },
    [wakeLock, desktop, platform],
  )

  const stop = useCallback(() => {
    stopStream(streamRef.current)
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setActual(null)
    setStatus({ kind: 'idle' })
    void wakeLock.release()
  }, [wakeLock])

  useEffect(() => () => stopStream(streamRef.current), [])

  // A device appearing or disappearing while idle should still refresh the
  // list, so the picker is right before the next Start.
  useEffect(() => {
    const md = navigator.mediaDevices
    if (!md?.addEventListener) return
    const onChange = () => {
      void listVideoInputs().then(setDevices)
    }
    md.addEventListener('devicechange', onChange)
    return () => md.removeEventListener('devicechange', onChange)
  }, [])

  // ---- remembering ------------------------------------------------------

  useEffect(() => {
    const label = devices.find((d) => d.deviceId === deviceId)?.label
    const next: Settings = {
      ...settings,
      deviceId,
      label,
      width: mode?.width,
      height: mode?.height,
      fps: mode?.fps,
    }
    saveSettings(next)
    // settings is intentionally not a dependency: this writes it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deviceId, mode, settings.fit, settings.mirror, settings.rotation, devices])

  // ---- fullscreen, idle cursor, keys ------------------------------------

  // In a tab, full screen is the Fullscreen API on the stage element. In the
  // app it is the window: an element full-screened inside a desktop window
  // would still have the window's own title bar and border around it, and the
  // window manager can take the app in and out of full screen without the page
  // being involved at all — so the state is read from the shell, not guessed.
  useEffect(() => {
    if (desktop) {
      void desktop.isFullScreen().then(setFullscreen)
      return desktop.onFullScreenChange(setFullscreen)
    }
    const onChange = () => setFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [desktop])

  const toggleFullscreen = useCallback(async () => {
    try {
      if (desktop) {
        // Asked for, not set here: on macOS the change is animated, so reading
        // it back now reports the state it is leaving. The shell's
        // enter/leave-full-screen event is what updates `fullscreen`.
        await desktop.setFullScreen(!(await desktop.isFullScreen()))
        return
      }
      if (document.fullscreenElement) await document.exitFullscreen()
      else await stageRef.current?.requestFullscreen()
    } catch {
      /* refused (iOS Safari on an element): the page still works windowed */
    }
  }, [desktop])

  useEffect(() => {
    let timer: number | undefined
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 2500)
    }
    wake()
    window.addEventListener('mousemove', wake)
    window.addEventListener('keydown', wake)
    window.addEventListener('touchstart', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', wake)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('touchstart', wake)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      if (e.key === 'f' || e.key === 'F') void toggleFullscreen()
      // The browser handles Escape itself and mostly does not deliver the key
      // to the page; a full-screen desktop window does, and would otherwise
      // have no way out but the menu.
      else if (e.key === 'Escape' && desktop && fullscreen) void toggleFullscreen()
      else if (e.key === 'm' || e.key === 'M') setSettings((s) => ({ ...s, mirror: !s.mirror }))
      else if (e.key === 'r' || e.key === 'R') setSettings((s) => ({ ...s, rotation: nextRotation(s.rotation) }))
      else if (e.key === 'c' || e.key === 'C')
        setSettings((s) => ({ ...s, fit: s.fit === 'contain' ? 'cover' : 'contain' }))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleFullscreen, desktop, fullscreen])

  // The rotated-picture scale needs the stage's own aspect, not the video's.
  useEffect(() => {
    const el = stageRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setBox({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  const transform = transformFor(settings.rotation, settings.mirror, box)
  const downscaled = isDownscaled(mode, actual)
  const chromeHidden = live && idle && fullscreen

  return (
    <div className="app">
      <div ref={stageRef} className={`stage ${chromeHidden ? 'no-cursor' : ''}`}>
        <video
          ref={videoRef}
          className="picture"
          style={{ objectFit: settings.fit, transform }}
          playsInline
          muted
          autoPlay
        />

        {!live && (
          <div className="overlay">
            {status.kind === 'error' ? (
              <div className="card error" role="alert">
                <h2>{status.message}</h2>
                {status.hint && <p>{status.hint}</p>}
                <button className="primary" onClick={() => void start(deviceId, mode)}>
                  Try again
                </button>
              </div>
            ) : (
              <div className="card">
                <h1>Peephole</h1>
                <p>
                  A camera or capture card, full screen, and nothing else. Nothing is recorded and
                  nothing leaves this {platform ? 'machine' : 'browser'}.
                </p>
                <button
                  className="primary"
                  disabled={status.kind === 'starting'}
                  onClick={() => void start(deviceId, mode)}
                >
                  {status.kind === 'starting' ? 'Starting…' : 'Start'}
                </button>
                <p className="fine">{startNote(platform)}</p>
              </div>
            )}

            {/* Opens the shared About dialog — see public/about.js, which delegates
                this attribute from the document, so nothing needs importing here.
                Under the card rather than in the control bar: this is the chrome
                that is already gone once there is a picture, and the version, the
                licence and the guide are a read-once thing. */}
            <button type="button" className="about" data-stoatworks-about>
              About
            </button>
          </div>
        )}

        {live && (
          <div className={`controls ${chromeHidden ? 'hidden' : ''}`}>
            <label>
              <span>Device</span>
              <select
                value={deviceId ?? ''}
                onChange={(e) => {
                  const id = e.target.value
                  setDeviceId(id)
                  void start(id, mode)
                }}
              >
                {devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Mode</span>
              <select
                value={mode ? `${mode.width}x${mode.height}` : ''}
                onChange={(e) => {
                  const [w, h] = e.target.value.split('x').map(Number)
                  const next = w && h ? { width: w, height: h } : undefined
                  setMode(next)
                  void start(deviceId, next)
                }}
              >
                <option value="">Whatever the device offers</option>
                {modes.map((m) => (
                  <option key={`${m.width}x${m.height}`} value={`${m.width}x${m.height}`}>
                    {m.width} × {m.height}
                  </option>
                ))}
              </select>
            </label>

            <button onClick={() => setSettings((s) => ({ ...s, fit: s.fit === 'contain' ? 'cover' : 'contain' }))}>
              {settings.fit === 'contain' ? 'Fit' : 'Fill'}
            </button>
            <button
              className={settings.mirror ? 'on' : ''}
              onClick={() => setSettings((s) => ({ ...s, mirror: !s.mirror }))}
            >
              Mirror
            </button>
            <button onClick={() => setSettings((s) => ({ ...s, rotation: nextRotation(s.rotation) }))}>
              {settings.rotation}°
            </button>
            <button onClick={() => void toggleFullscreen()}>{fullscreen ? 'Exit full screen' : 'Full screen'}</button>
            <button onClick={stop}>Stop</button>

            <span className="readout" title="What the device actually settled on">
              {describe(actual)}
              {downscaled && mode && (
                <em className="warn"> — asked for {mode.width} × {mode.height}</em>
              )}
              {!wakeLock.supported && <em className="warn"> — this browser may still sleep the screen</em>}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
