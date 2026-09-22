# Peephole

> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code).
> The design decisions, the testing and the verdicts below are a human's.

A camera or capture card, full screen — in a browser tab, or as a desktop app
that runs completely offline.

**<https://peephole.stoatworks-labs.com>** · [Desktop app](#desktop-app)

You have a camera or an HDMI capture card plugged in and you want to *look at it*
— on a second screen, at the back of the room, on the laptop next to the desk.
OBS will do it, after a scene, a source, a preview, a projector output and a
window to hide. This is the same job with nothing in front of it: open the page,
press Start, press Full screen.

Nothing is recorded, nothing is uploaded, and there is no account. The picture
goes from the device to the screen and stops there — no server is involved, and
there is nothing in this app that could send it anywhere. The desktop build goes
further and cannot open a network connection at all.

## What it does that a bare `getUserMedia` page does not

- **Gives a capture card its real resolution.** A UVC card advertises a list of
  modes, and browsers pick a conservative default from it — plug in a 1080p HDMI
  card and you get 640 × 480, with nothing on screen to say so. Peephole asks the
  device what it can do, offers those modes, and shows what the stream actually
  settled on. If you asked for 1080p and got VGA, it says so in the readout
  rather than leaving you to wonder why the picture is soft.
- **Keeps the screen awake.** A confidence monitor that dims after ten minutes
  is not a confidence monitor. Where the browser has the Screen Wake Lock API,
  the lock is held while a picture is up and re-taken when you come back to the
  tab (browsers drop it whenever the tab is hidden). Where it does not —
  Firefox, older Safari — the readout says the screen may still sleep, rather
  than pretending.
- **Comes back to the same device.** The device and mode are remembered. Ids are
  rotated whenever you reset the site's camera permission, so the name is
  remembered too and used to find the same device again; if neither matches, it
  falls back to any camera and tells you which one rather than showing an error.
- **Says what went wrong in words.** "Something else usually has it: OBS, Teams,
  Zoom, or another tab of this page" beats `NotReadableError`.
- **Gets out of the way.** In full screen the bar and the cursor fade after a
  couple of seconds of stillness.

Mirror, rotate in quarter turns, and fit or fill. Keyboard: **F** full screen,
**M** mirror, **R** rotate, **C** fit/fill.

## Desktop app

The same application, packaged with Electron for macOS, Windows and Linux. It
needs no network at all — not to install, not to run, not ever — which is the
point for a machine on a show network with no route out, or one that simply
should not be talking to anything.

It is not a wrapper around the website. There is no `localhost` server and no
hosted page being loaded; the bundle is served to the window over a registered
`app://` scheme from inside the application itself.

**Why Electron and not something lighter.** The mode picker is the reason this
tool exists, and it is built from `getCapabilities()`, which only Chromium
implements. A shell that used the system webview would give the real mode list
on Windows and a guessed ladder on macOS and Linux — the same tool behaving
differently on each desk. Electron brings its own Chromium, so all three
platforms get the device's actual capabilities.

What the app has that the tab does not:

- **Full screen is the window**, not an element inside it, so nothing of the
  application is left around the picture. **Esc** leaves it.
- **The screen stays awake properly.** A power-save blocker held by the
  process, rather than the Screen Wake Lock API — which Firefox does not have
  at all and which every browser drops the moment the window is hidden.
- **No permission theatre.** No https requirement, no padlock, and when access
  is refused the message names the operating system's own setting rather than
  an address bar the app does not have.
- **It keeps painting when it is behind something.** Chromium throttles an
  occluded window; a confidence monitor is usually the window you are *not*
  looking at, so the app turns that off.

And what it deliberately does not have: no updater, no telemetry, no analytics,
no crash reporting. The page is served a Content-Security-Policy with
`connect-src 'none'`, and the main process cancels every http/https/ws request
besides. Both halves are verified in the test run below.

### Installing

Downloads are on the [releases page](https://github.com/stoatworks-labs/peephole/releases).

| | |
| --- | --- |
| macOS | `.dmg` — `universal` for any Mac, `arm64` if you want the smaller one |
| Windows | `-setup.exe` to install, or `-portable.exe` to run from a stick |
| Linux | `.AppImage` (nothing to install), `.deb`, `.rpm` |

macOS builds are **ad-hoc signed, not notarised**, so Gatekeeper will refuse the
first launch. After dragging it to Applications:

```bash
xattr -dr com.apple.quarantine /Applications/Peephole.app
```

The first time you press Start, macOS and Windows will ask for camera access.
If you say no, the app cannot ask again — the setting then lives in **System
Settings ▸ Privacy & Security ▸ Camera** or **Settings ▸ Privacy & security ▸
Camera**, and the app says so when it is refused.

## What it does not do

No recording, no snapshots, no streaming out, no audio. Those are all reasonable
things to want and all reasons to use something bigger — [OBS](https://obsproject.com)
for production, or [frame-ferret](https://github.com/stoatworks-labs/frame-ferret)
if what you actually want is a capture device on the network. This page is for
looking.

## Browser support

Any browser with `getUserMedia` on a secure page: Chrome, Edge, Safari and
Firefox, desktop or mobile. Two differences worth knowing:

| | Chromium | Safari | Firefox |
| --- | --- | --- | --- |
| Mode list from the device | ✅ real capabilities | ladder | ladder |
| Screen wake lock | ✅ | ✅ 16.4+ | ❌ — says so in the readout |

Where the device's own capabilities are not available, the page offers a
standard ladder (2160p down to 480p) and asks for the mode you pick; the readout
still reports what you really got.

The page must be served over **https** or from **localhost** — browsers give no
camera to an insecure origin.

The [desktop app](#desktop-app) is the Chromium column on all three platforms,
and has no secure-origin question to answer.

## Verification status

Read this as the authority on what has actually been checked.

| | |
| --- | --- |
| Unit tests | ✅ 48, covering constraint shape, capability filtering, the remembered-device fallback, rotation maths, the wake-lock lifecycle and the desktop bridge |
| Driven end to end in a browser | ✅ against an injected `MediaStream` — device switch, mode change, mirror, rotate, fit/fill, keyboard, stop, and settings surviving a restart |
| Driven end to end in the **desktop app** | ✅ against Chromium's fake capture device — Start, the device picker built from real labels, a mode change to 1920 × 1080 confirmed at the `<video>` element, the readout, window full screen through the shell, and settings persisting on the `app://` origin |
| The app cannot reach the network | ✅ `fetch` and an `<img>` to an https origin both refused from inside the page; a navigation away from `app://` refused by the main process |
| Against a **real camera** | ⚠️ **not yet, in either shape** — the automated browser this was built in blocks camera access by policy |
| Against a **real capture card** | ⚠️ **not yet, in either shape** |
| Full screen | ✅ in the desktop app (real window full screen) · ⚠️ in a browser, exercised only in a windowed pane |
| Windows and Linux builds | ⚠️ they package, and CI builds them on their own runners — but no one has **launched** them on Windows or Linux |

The capture-card behaviour is the whole point of the tool and is the part that
has not met hardware. Chromium's fake device proves the code path — it really
does report capabilities, really does renegotiate to 1080p, and the readout
really does follow — but a fake device always gives you what you ask for, which
is exactly what a real capture card does not. If you run it against a card, the
thing to watch is the readout: it should name the card's real mode, and the
warning should appear when you are handed something smaller than you asked for.

## Building

```
npm ci
npm test          # vitest
npm run dev       # vite, on localhost
npm run build     # tsc -b && vite build, into dist/
```

`dist/` is a static bundle — any web server will do, and `base` is relative so
it also works from a subdirectory or a folder on a show laptop.

### The desktop app

```
npm run electron:run     # build the shell and launch it
npm run dist             # installers for this platform, into dist-desktop/
npm run dist:win         # or :mac / :linux — electron-builder cross-builds
```

There is no dev server for the desktop shell, on purpose: the UI is iterated in
a browser with `npm run dev`, and the app has exactly one code path — built
assets over `app://`, with the network blocked — so it cannot behave one way in
development and another way in the build that ships.

Three output directories, which is two more than is comfortable, so:

| | |
| --- | --- |
| `dist/` | the hosted site. **This is what wrangler uploads to Cloudflare.** |
| `out/` | the compiled main, preload and renderer |
| `dist-desktop/` | installers from `npm run dist` |
| `dist-release/` | installers from `scripts/release-local.sh`, which signs and notarises |

`scripts/release-local.sh` cuts a signed, notarised release from a Mac that has
a Developer ID; `.github/workflows/release.yml` does the same on a `v*` tag,
ad-hoc signed. Both leave `dist/` alone.

`build/icon.png` is generated — `npm run icon` draws it, `npm run icon:check`
fails if the committed file is no longer what the code draws.

<!-- attributions:start -->
This project is built on other people's work — see [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
<!-- attributions:end -->

## Licence

MIT. See [LICENSE](LICENSE).
