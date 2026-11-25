import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import {
  atEdge,
  barHidden,
  edgeForKey,
  edgeReveal,
  isVertical,
  menuPlacement,
  nearestEdge,
  type AutoHide,
  type Edge,
} from './lib/bar'
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
import { chooseDevice, loadSettings, nextRotation, rememberLabel, saveSettings, transformFor, type Settings } from './lib/view'
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
  // The bar. `stowed` is the Hide button and is not remembered: a bar that
  // came back hidden after a reload would look like a bar that had gone.
  const [stowed, setStowed] = useState(false)
  const [hint, setHint] = useState(false)
  const [hover, setHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [menuAt, setMenuAt] = useState<CSSProperties>({})
  /** The edge a drag would land on, while one is in progress. */
  const [drag, setDrag] = useState<Edge | null>(null)

  const videoRef = useRef<HTMLVideoElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const barRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null)
  // Read by the window-level pointer listeners, which are registered once.
  const stowedRef = useRef(stowed)
  stowedRef.current = stowed
  const edgeRef = useRef(settings.edge)
  edgeRef.current = settings.edge
  const armedRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  // The name of the device last used, for start()'s fallback without taking
  // `settings` as a dependency, which would rebuild it on every mirror or
  // rotate. It is the name last written, not the one loaded: picking another
  // device during a visit changes it.
  const labelRef = useRef(settings.label)
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
          const wanted = chooseDevice(found, { label: labelRef.current })
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
    // The next Start should show its controls.
    setStowed(false)
    setMenuOpen(false)
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
    const label = rememberLabel(devices, deviceId, labelRef.current)
    labelRef.current = label
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
  }, [deviceId, mode, settings.fit, settings.mirror, settings.rotation, settings.edge, settings.autoHide, devices])

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

  // ---- the bar: stowing, the menu, docking -----------------------------

  const stow = useCallback(() => {
    // The pointer is on the Hide button, which is inside the reveal strip:
    // it has to leave the strip before the strip can bring the bar back.
    armedRef.current = false
    setMenuOpen(false)
    setHover(false)
    setStowed(true)
    setHint(true)
    // `inert` takes focus off a hidden control in the browsers that have it;
    // this is for the ones that do not, where Space would press it unseen.
    ;(document.activeElement as HTMLElement | null)?.blur?.()
  }, [])

  const unstow = useCallback(() => {
    setStowed(false)
    setHint(false)
  }, [])

  useEffect(() => {
    if (!hint) return
    const t = window.setTimeout(() => setHint(false), 4000)
    return () => window.clearTimeout(t)
  }, [hint])

  const setEdge = useCallback((edge: Edge) => setSettings((s) => ({ ...s, edge })), [])
  const setAutoHide = useCallback((autoHide: AutoHide) => setSettings((s) => ({ ...s, autoHide })), [])

  // The menu hangs off the stage, not the bar, so it is placed by measuring
  // both — again whenever the bar moves to another edge or the window resizes.
  useLayoutEffect(() => {
    if (!menuOpen) return
    const place = () => {
      const button = menuButtonRef.current?.getBoundingClientRect()
      const bar = barRef.current?.getBoundingClientRect()
      const stage = stageRef.current?.getBoundingClientRect()
      if (button && bar && stage) setMenuAt(menuPlacement(settings.edge, button, bar, stage))
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [menuOpen, settings.edge])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || menuButtonRef.current?.contains(t)) return
      setMenuOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [menuOpen])

  /** The edge nearest a pointer event, for the drag. */
  const edgeAt = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current?.getBoundingClientRect()
    if (!r) return null
    return nearestEdge(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }

  // ---- activity: the idle timer, and bringing a stowed bar back ---------

  useEffect(() => {
    let timer: number | undefined
    const wake = () => {
      setIdle(false)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setIdle(true), 2500)
    }
    const onMove = (e: MouseEvent) => {
      wake()
      if (!stowedRef.current) return
      const inZone = atEdge(edgeRef.current, e.clientX, e.clientY, window.innerWidth, window.innerHeight)
      const next = edgeReveal(armedRef.current, inZone)
      armedRef.current = next.armed
      if (next.reveal) unstow()
    }
    wake()
    window.addEventListener('mousemove', onMove)
    window.addEventListener('keydown', wake)
    window.addEventListener('touchstart', wake)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('keydown', wake)
      window.removeEventListener('touchstart', wake)
    }
  }, [unstow])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName)) return
      // The menu first: Escape closing it must not also leave full screen.
      if (e.key === 'Escape' && menuOpen) setMenuOpen(false)
      else if ((e.key === 'h' || e.key === 'H') && live) {
        if (stowedRef.current) unstow()
        else stow()
      } else if (e.key === 'f' || e.key === 'F') void toggleFullscreen()
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
  }, [toggleFullscreen, desktop, fullscreen, menuOpen, live, stow, unstow])

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
  const held = hover || menuOpen || drag !== null
  const hidden = barHidden({ stowed, autoHide: settings.autoHide, fullscreen, idle, held })
  // The pointer goes with the bar, and in full screen with stillness whatever
  // the bar is doing — but never while it is resting on the bar itself.
  const noCursor = live && idle && !held && (fullscreen || hidden)
  const edge = settings.edge
  const coarse = useMemo(() => window.matchMedia?.('(pointer: coarse)').matches ?? false, [])

  return (
    <div className="app">
      <div
        ref={stageRef}
        className={`stage ${noCursor ? 'no-cursor' : ''}`}
        // A stowed bar is not under the pointer to click, so the picture is
        // the way back that works with a mouse and a finger alike.
        onClick={() => {
          if (live && stowed) unstow()
        }}
      >
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
            {/* The start screen's navy bar: the name, and the shared About dialog
                (public/about.js delegates this attribute from the document, so
                nothing needs importing here). It lives on this screen, not in the
                control bar: this is the chrome that is already gone once there is
                a picture, and the version, the licence and the guide are a
                read-once thing. */}
            <header className="sw-bar start-bar">
              <span className="sw-brand">
                <span className="sw-mark" aria-hidden="true">◉</span> Peephole
              </span>
              <button type="button" data-stoatworks-about>
                About
              </button>
            </header>

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
                {/* The hosted page only: the desktop app has its own way to the
                    guide in the About dialog, and this is the web tool's page. */}
                {platform ? null : (
                  <p className="fine">
                    <a href="https://stoatworks-labs.com/web-tools/peephole/" target="_blank" rel="noopener">
                      Peephole on Stoatworks Labs
                    </a>
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {live && (
          <div
            ref={barRef}
            className={[
              'controls',
              `edge-${edge}`,
              isVertical(edge) ? 'vertical' : '',
              hidden ? 'hidden' : '',
              drag ? 'dragging' : '',
            ].join(' ')}
            // Stowed is gone, not just transparent: nothing in it can be
            // tabbed to or pressed without being seen.
            inert={stowed}
            onPointerEnter={(e) => {
              if (e.pointerType === 'mouse') setHover(true)
            }}
            onPointerLeave={() => setHover(false)}
          >
            <button
              type="button"
              className="grip"
              aria-label="Move the bar"
              title="Drag to another edge of the screen, or use the arrow keys"
              onPointerDown={(e) => {
                if (e.button !== 0) return
                e.currentTarget.setPointerCapture(e.pointerId)
                dragRef.current = { x: e.clientX, y: e.clientY, moved: false }
              }}
              onPointerMove={(e) => {
                const d = dragRef.current
                if (!d) return
                // A few pixels of slack, so a click on the handle is not a drag.
                if (!d.moved && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return
                d.moved = true
                setMenuOpen(false)
                setDrag(edgeAt(e))
              }}
              onPointerUp={(e) => {
                const d = dragRef.current
                dragRef.current = null
                const to = d?.moved ? edgeAt(e) : null
                if (to) setEdge(to)
                setDrag(null)
              }}
              onPointerCancel={() => {
                dragRef.current = null
                setDrag(null)
              }}
              onKeyDown={(e) => {
                const to = edgeForKey(e.key)
                if (!to) return
                e.preventDefault()
                setEdge(to)
              }}
            >
              <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                {[2, 8].map((x) => [3, 8, 13].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />))}
              </svg>
            </button>

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

            <span className="bar-tools">
              <button
                ref={menuButtonRef}
                type="button"
                className={menuOpen ? 'on' : ''}
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                title="Where the bar sits, and when it hides"
                onClick={() => setMenuOpen((o) => !o)}
              >
                Bar
              </button>
              <button
                type="button"
                title={coarse ? 'Hide the bar. Tap the picture to bring it back.' : 'Hide the bar (H). Click the picture, press H, or push the pointer against this edge to bring it back.'}
                onClick={stow}
              >
                Hide
              </button>
            </span>
          </div>
        )}

        {live && menuOpen && (
          <div ref={menuRef} className="bar-menu" role="dialog" aria-label="Bar" style={menuAt}>
            <div className="bar-menu-row">
              <span className="bar-menu-label" id="bar-pos">
                Position
              </span>
              <div className="dpad" role="group" aria-labelledby="bar-pos">
                {(['top', 'left', 'right', 'bottom'] as const).map((e) => (
                  <button
                    key={e}
                    type="button"
                    className={`dpad-${e} ${edge === e ? 'on' : ''}`}
                    aria-pressed={edge === e}
                    onClick={() => setEdge(e)}
                  >
                    {e[0].toUpperCase() + e.slice(1)}
                  </button>
                ))}
              </div>
            </div>
            <div className="bar-menu-row">
              <span className="bar-menu-label" id="bar-auto">
                Auto-hide
              </span>
              <div className="seg" role="group" aria-labelledby="bar-auto">
                {(
                  [
                    ['never', 'Never'],
                    ['fullscreen', 'In full screen'],
                    ['always', 'Always'],
                  ] as const
                ).map(([value, words]) => (
                  <button
                    key={value}
                    type="button"
                    className={settings.autoHide === value ? 'on' : ''}
                    aria-pressed={settings.autoHide === value}
                    onClick={() => setAutoHide(value)}
                  >
                    {words}
                  </button>
                ))}
              </div>
            </div>
            <p className="bar-menu-fine">Or drag the bar by its handle. H hides it.</p>
          </div>
        )}

        {drag && <div className={`dock-preview edge-${drag}`} aria-hidden="true" />}

        {live && (
          <div className={`bar-hint edge-${edge} ${hint ? 'show' : ''}`} role="status">
            {hint
              ? coarse
                ? 'Bar hidden. Tap the picture to bring it back.'
                : 'Bar hidden. Click the picture or press H to bring it back.'
              : ''}
          </div>
        )}
      </div>
    </div>
  )
}
