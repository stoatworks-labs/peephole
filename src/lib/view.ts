/**
 * How the picture sits on the screen, and what is remembered between visits.
 */

export type Fit = 'contain' | 'cover'
export type Rotation = 0 | 90 | 180 | 270

export type Settings = {
  /** The deviceId last used. Ids are stable per browser profile, until they are not. */
  deviceId?: string
  /** The label too: ids are revoked when permission is reset, labels usually survive. */
  label?: string
  width?: number
  height?: number
  fps?: number
  fit: Fit
  mirror: boolean
  rotation: Rotation
}

export const DEFAULTS: Settings = {
  fit: 'contain',
  mirror: false,
  rotation: 0,
}

const KEY = 'peephole.settings.v1'

export function loadSettings(storage: Pick<Storage, 'getItem'> | undefined = safeStorage()): Settings {
  try {
    const raw = storage?.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    const parsed = JSON.parse(raw) as Partial<Settings>
    return {
      ...DEFAULTS,
      ...parsed,
      fit: parsed.fit === 'cover' ? 'cover' : 'contain',
      mirror: Boolean(parsed.mirror),
      rotation: normaliseRotation(parsed.rotation),
    }
  } catch {
    // A blocked or full store is not a reason to refuse to show a picture.
    return { ...DEFAULTS }
  }
}

export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | undefined = safeStorage()): void {
  try {
    storage?.setItem(KEY, JSON.stringify(s))
  } catch {
    /* private window, blocked storage: carry on */
  }
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  } catch {
    return undefined
  }
}

export function normaliseRotation(r: unknown): Rotation {
  const n = Number(r)
  if (!Number.isFinite(n)) return 0
  const wrapped = ((Math.round(n / 90) * 90) % 360 + 360) % 360
  return wrapped as Rotation
}

export function nextRotation(r: Rotation): Rotation {
  return normaliseRotation(r + 90)
}

/**
 * Pick the device to use on a fresh visit.
 *
 * The id is tried first and the label second, because the two fail in
 * different ways: ids are revoked whenever the site's camera permission is
 * reset (so the remembered id matches nothing), while labels survive that but
 * are identical across two of the same capture card. Id first, label as the
 * fallback, and the first device if neither matches — never nothing, which
 * would leave the page looking broken after a permission reset.
 */
export function chooseDevice<T extends { deviceId: string; label: string }>(
  devices: T[],
  remembered: { deviceId?: string; label?: string },
): T | undefined {
  if (!devices.length) return undefined
  if (remembered.deviceId) {
    const byId = devices.find((d) => d.deviceId === remembered.deviceId)
    if (byId) return byId
  }
  if (remembered.label) {
    const byLabel = devices.find((d) => d.label === remembered.label)
    if (byLabel) return byLabel
  }
  return devices[0]
}

/**
 * The CSS transform for mirror and rotation.
 *
 * Rotation is applied about the centre; at 90 and 270 the video's own box is
 * still landscape, so it is also scaled to fit the short axis. Without that a
 * rotated 16:9 picture is cropped to a letterbox of itself.
 */
export function transformFor(rotation: Rotation, mirror: boolean, box: { w: number; h: number }): string {
  const parts: string[] = []
  if (rotation) parts.push(`rotate(${rotation}deg)`)
  if (rotation === 90 || rotation === 270) {
    const scale = box.w && box.h ? Math.min(box.h / box.w, box.w / box.h) : 1
    if (scale && Number.isFinite(scale) && scale !== 1) parts.push(`scale(${round(scale)})`)
  }
  if (mirror) parts.push('scaleX(-1)')
  return parts.join(' ') || 'none'
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
