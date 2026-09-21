/**
 * Picking a camera or capture device, and getting a useful picture out of it.
 *
 * The two things that make this more than `getUserMedia({video: true})`:
 *
 *  1. **Labels are empty until permission is granted.** `enumerateDevices()`
 *     returns entries with a deviceId and a blank label before the first
 *     successful getUserMedia, so a picker built from a cold enumerate is a
 *     list of "" and nothing else. Ask for a stream first, then enumerate.
 *
 *  2. **A capture card will hand you 640x480 if you let it.** UVC devices
 *     advertise a mode list and browsers pick a conservative default, so an
 *     HDMI card carrying 1080p shows up as VGA unless the page asks for the
 *     mode it wants. Nothing in the UI hints at that; the picture is simply
 *     soft.
 */

export type Device = {
  deviceId: string
  label: string
  /** Set when the browser reports a group, used to pair a camera with its mic. */
  groupId: string
}

export type Mode = {
  width: number
  height: number
  /** Frames per second, when the device reports one. */
  fps?: number
}

/** What a stream actually settled on, which is not always what was asked for. */
export type Actual = {
  width: number
  height: number
  fps?: number
  deviceId?: string
  label?: string
}

/**
 * The modes worth offering when a device does not report its own.
 *
 * Ordered high to low: the first that applies is the best the device can do,
 * and probing stops there. 1920x1080 sits above 1280x720 because that is the
 * pair most capture cards carry, and DCI/UHD above both for the cards that do.
 */
export const LADDER: Mode[] = [
  { width: 3840, height: 2160 },
  { width: 2560, height: 1440 },
  { width: 1920, height: 1080 },
  { width: 1280, height: 720 },
  { width: 960, height: 540 },
  { width: 640, height: 480 },
]

/** Video inputs only, in the order the browser gives them. */
export async function listVideoInputs(): Promise<Device[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return []
  const all = await navigator.mediaDevices.enumerateDevices()
  return all
    .filter((d) => d.kind === 'videoinput')
    .map((d, i) => ({
      deviceId: d.deviceId,
      label: d.label || `Camera ${i + 1}`,
      groupId: d.groupId,
    }))
}

/**
 * The modes a device says it supports, newest-browser path first.
 *
 * `getCapabilities()` is Chromium-only; Safari and Firefox return nothing
 * useful, so the ladder is the fallback. Capabilities give a *range* rather
 * than a list — a card that does 1080p reports width up to 1920 — so the
 * ladder is filtered by that range rather than replaced by it.
 */
export function modesFromCapabilities(caps: MediaTrackCapabilities | undefined): Mode[] {
  if (!caps?.width || !caps?.height) return LADDER
  const maxW = typeof caps.width === 'object' ? (caps.width.max ?? 0) : 0
  const maxH = typeof caps.height === 'object' ? (caps.height.max ?? 0) : 0
  if (!maxW || !maxH) return LADDER
  const fits = LADDER.filter((m) => m.width <= maxW && m.height <= maxH)
  // A device whose maximum is not on the ladder still deserves its maximum.
  if (!fits.some((m) => m.width === maxW && m.height === maxH)) {
    fits.unshift({ width: maxW, height: maxH })
  }
  return fits.length ? fits : LADDER
}

/**
 * Constraints for one device at one mode.
 *
 * `ideal` and not `exact` on the size: exact makes the browser throw
 * OverconstrainedError when a card cannot do the mode, which loses the picture
 * entirely for the sake of a resolution. Ideal gets as close as the device can,
 * and `actualOf()` reports what really happened so the UI can say so.
 *
 * The deviceId IS exact. Asking "ideally this camera" and getting a different
 * one is worse than an error: you are looking at the wrong input and nothing
 * says so.
 */
export function constraintsFor(deviceId: string | undefined, mode: Mode | undefined): MediaStreamConstraints {
  const video: MediaTrackConstraints = {}
  if (deviceId) video.deviceId = { exact: deviceId }
  if (mode) {
    video.width = { ideal: mode.width }
    video.height = { ideal: mode.height }
    if (mode.fps) video.frameRate = { ideal: mode.fps }
  }
  return { video: Object.keys(video).length ? video : true, audio: false }
}

/** What the stream settled on. */
export function actualOf(stream: MediaStream | null): Actual | null {
  const track = stream?.getVideoTracks()[0]
  if (!track) return null
  const s = track.getSettings()
  return {
    width: s.width ?? 0,
    height: s.height ?? 0,
    fps: s.frameRate ? Math.round(s.frameRate) : undefined,
    deviceId: s.deviceId,
    label: track.label,
  }
}

/** "1920 × 1080 at 60fps", or the part of it that is known. */
export function describe(a: Actual | Mode | null): string {
  if (!a || !a.width || !a.height) return '—'
  const size = `${a.width} × ${a.height}`
  return a.fps ? `${size} at ${a.fps}fps` : size
}

/**
 * Whether what came back is meaningfully smaller than what was asked for.
 *
 * Worth saying out loud in the UI: it is the difference between "this card is
 * 1080p" and "this card is 1080p and you are watching it at VGA". A few pixels
 * either way (1920x1088 sensors, 1918-wide crops) is not worth a warning.
 */
export function isDownscaled(asked: Mode | undefined, got: Actual | null): boolean {
  if (!asked || !got || !got.width) return false
  return got.width < asked.width - 16 || got.height < asked.height - 16
}

export function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop())
}
