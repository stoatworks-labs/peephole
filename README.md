# Peephole

> **AI-assisted project.** This codebase was created with [Claude Code](https://claude.com/claude-code).
> The design decisions, the testing and the verdicts below are a human's.

A camera or capture card, full screen, in a browser tab.

**<https://peephole.stoatworks-labs.com>**

You have a camera or an HDMI capture card plugged in and you want to *look at it*
— on a second screen, at the back of the room, on the laptop next to the desk.
OBS will do it, after a scene, a source, a preview, a projector output and a
window to hide. This is the same job with nothing in front of it: open the page,
press Start, press Full screen.

Nothing is recorded, nothing is uploaded, and there is no account. The picture
goes from the device to the screen inside your browser and stops there — no
server is involved, and there is nothing in this app that could send it
anywhere.

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

## Verification status

Read this as the authority on what has actually been checked.

| | |
| --- | --- |
| Unit tests | ✅ 36, covering constraint shape, capability filtering, the remembered-device fallback, rotation maths and the wake-lock lifecycle |
| Driven end to end in a browser | ✅ against an injected `MediaStream` — device switch, mode change, mirror, rotate, fit/fill, keyboard, stop, and settings surviving a restart |
| Against a **real camera** | ⚠️ **not yet** — the automated browser this was built in blocks camera access by policy |
| Against a **real capture card** | ⚠️ **not yet** |
| Full screen | ⚠️ exercised only in a windowed browser pane |

The capture-card behaviour is the whole point of the tool and is the part that
has not met hardware. If you run it against a card, the thing to watch is the
readout: it should name the card's real mode, and the warning should appear if
the browser hands back something smaller than you asked for.

## Building

```
npm ci
npm test          # vitest
npm run dev       # vite, on localhost
npm run build     # tsc -b && vite build, into dist/
```

`dist/` is a static bundle — any web server will do, and `base` is relative so
it also works from a subdirectory or a folder on a show laptop.

## Licence

MIT. See [LICENSE](LICENSE).
