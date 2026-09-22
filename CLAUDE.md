# Peephole — working notes

A React + TypeScript page that opens a camera or capture card and shows it, full
screen. It ships in two shapes from one `src/`:

- **Hosted**, a Vite build deployed as a Cloudflare static-assets Worker at
  `peephole.stoatworks-labs.com`.
- **Desktop**, the same renderer inside an Electron shell, for macOS, Windows
  and Linux, with no network at all.

No server, no storage, no network calls, in either shape.

## The shape

- `src/lib/devices.ts` — enumeration, constraints, and reading back what a
  stream settled on. The interesting part of the app.
- `src/lib/view.ts` — fit/mirror/rotation, the remembered settings, and the
  device-matching fallback.
- `src/lib/wakelock.ts` — the Screen Wake Lock lifecycle, or the desktop
  power-save blocker when there is one.
- `src/lib/desktop.ts` — the page's half of the Electron bridge, and the
  platform-dependent wording. `getDesktop()` returns null in a browser.
- `src/App.tsx` — the one component: start/stop, the control bar, the overlay.
- `electron/main/index.ts` — the shell: the `app://` protocol, the permission
  handler, the request block, the power-save blocker, the window.
- `electron/preload/index.ts` — the other half of the bridge, and the entire
  surface the page is given.

## Two shapes, one renderer

`src/` must never assume it is in an app. The desktop features are reached
through `getDesktop()`, which is null in a tab, and every caller keeps its web
behaviour in that case. That is what lets the hosted build stay exactly what it
was.

Three build configs, and they are not interchangeable:

| | writes | for |
| --- | --- | --- |
| `vite.config.ts` | `dist/` | the hosted site — **what wrangler uploads** |
| `vite.electron.node.config.ts` | `out/main`, `out/preload` | CommonJS, because package.json is `type: module` |
| `vite.electron.renderer.config.ts` | `out/renderer` | the same `src/`, its own index.html |

`electron-builder.yml` writes to `dist-desktop/`, **not** the default `dist/`.
That default would drop a 126 MB .dmg into the directory wrangler serves.

## Things that are easy to get wrong here

- **Device labels are empty before permission.** `enumerateDevices()` returns
  blank labels until a `getUserMedia` has succeeded, so the picker is built
  after the first stream, never before.
- **`deviceId` is `exact`, the size is `ideal`.** Being handed a different
  camera than the one chosen is worse than an error, because nothing on screen
  would say so. A size that cannot be met should still give a picture, and the
  readout reports the difference.
- **A remembered `deviceId` stops matching when site permissions are reset** —
  the ids are rotated. The label is the second key, and `chooseDevice()` is
  where that lives.
- **The browser drops the wake lock whenever the tab is hidden**, so it is
  re-taken on `visibilitychange`.
- **A track that ends on its own leaves a frozen last frame**, which reads as
  "working". The `ended` listener turns that into a message.

## Things that are easy to get wrong in the desktop shell

- **`NSCameraUsageDescription` is not optional.** macOS does not refuse a
  camera to a process without a usage string — it **terminates the process**.
  The symptom is the app vanishing, not an error anyone can read. It comes from
  `extendInfo` in electron-builder.yml, and release.yml re-reads it out of the
  packaged Info.plist because a config refactor would drop it in silence.
- **The hardened runtime needs `com.apple.security.device.camera` too.**
  electron-builder turns the hardened runtime on by default, and it gates the
  camera separately from TCC — so without the entitlement the user grants
  access and the app still cannot open a device. **Do not add
  `scripts/mac-entitlements.plist`** by copying another repo's: `rl_init`
  auto-detects that file and `release-electron.sh` then overrides
  `mac.entitlements` with it, which would replace `build/entitlements.mac.plist`
  and quietly drop the camera entitlement from every signed release.
- **`file://` is not good enough**, which is why there is a protocol handler at
  all. It is an opaque origin: no stable identity to hang a camera permission
  or a localStorage bucket on. `app://` is registered `standard` + `secure`,
  and the remembered device survives a restart because of it.
- **`setFullScreen` cannot report back.** On macOS the change is animated, so
  `isFullScreen()` immediately afterwards still returns the old value. The
  handler deliberately returns nothing and the page waits for the window's own
  `enter-full-screen` / `leave-full-screen` event — which is also the only
  thing that fires when the window manager does it unasked.
- **`backgroundThrottling: false` is load-bearing.** A confidence monitor is
  usually the window you are not looking at, and Chromium throttles an occluded
  one. This is the desktop version of the visibilitychange problem the hosted
  build has to work around.
- **electron@44 has no postinstall.** It exposes an `install-electron` bin
  instead, so `npm ci` does **not** fetch the binary and `electron .` fails
  with nothing useful. `electron:start` runs `install-electron` first; it costs
  40 ms once the download is cached. electron-builder is unaffected — it
  fetches its own dist per target arch.

## Verification

`npm test` is 36 unit tests. The end-to-end pass was done by injecting a
`MediaStream` from a canvas over `navigator.mediaDevices`, which exercises
everything but the browser's permission gate — see README's verification table
for what has and has not met real hardware. **No real camera or capture card has
run through this yet.**
