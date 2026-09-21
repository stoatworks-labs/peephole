# Peephole — working notes

A static React + TypeScript page that opens a camera or capture card and shows
it, full screen. Vite build, deployed as a Cloudflare static-assets Worker at
`peephole.stoatworks-labs.com`. No server, no storage, no network calls.

## The shape

- `src/lib/devices.ts` — enumeration, constraints, and reading back what a
  stream settled on. The interesting part of the app.
- `src/lib/view.ts` — fit/mirror/rotation, the remembered settings, and the
  device-matching fallback.
- `src/lib/wakelock.ts` — the Screen Wake Lock lifecycle.
- `src/App.tsx` — the one component: start/stop, the control bar, the overlay.

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

## Verification

`npm test` is 36 unit tests. The end-to-end pass was done by injecting a
`MediaStream` from a canvas over `navigator.mediaDevices`, which exercises
everything but the browser's permission gate — see README's verification table
for what has and has not met real hardware. **No real camera or capture card has
run through this yet.**
