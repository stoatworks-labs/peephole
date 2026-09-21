/**
 * Keeping the screen on while a picture is up.
 *
 * A confidence monitor that dims after ten minutes is not a confidence
 * monitor. The Screen Wake Lock API holds it awake, with two catches worth
 * handling rather than hoping about:
 *
 *  * The lock is released by the browser whenever the tab is hidden — switch
 *    away and back and it is silently gone — so it is re-taken on
 *    visibilitychange.
 *  * It does not exist in Firefox or older Safari. There is no polyfill worth
 *    having (the video-loop trick burns battery for a worse result), so the
 *    page says the screen may sleep rather than pretending otherwise.
 */

export type WakeLock = {
  /** Take the lock, if this browser has one. Safe to call repeatedly. */
  acquire(): Promise<boolean>
  release(): Promise<void>
  supported: boolean
}

type SentinelLike = { released: boolean; release(): Promise<void>; addEventListener?: (t: string, f: () => void) => void }

export function createWakeLock(
  nav: Navigator | undefined = typeof navigator === 'undefined' ? undefined : navigator,
  doc: Document | undefined = typeof document === 'undefined' ? undefined : document,
): WakeLock {
  const api = (nav as Navigator & { wakeLock?: { request(t: 'screen'): Promise<SentinelLike> } })?.wakeLock
  let sentinel: SentinelLike | null = null
  let wanted = false

  async function acquire(): Promise<boolean> {
    wanted = true
    if (!api) return false
    if (sentinel && !sentinel.released) return true
    try {
      sentinel = await api.request('screen')
      sentinel.addEventListener?.('release', () => {
        sentinel = null
      })
      return true
    } catch {
      // Denied, or the document was not visible. Not worth an error to the
      // user: the picture is still there, the screen may just dim.
      sentinel = null
      return false
    }
  }

  async function release(): Promise<void> {
    wanted = false
    try {
      await sentinel?.release()
    } catch {
      /* already gone */
    }
    sentinel = null
  }

  doc?.addEventListener?.('visibilitychange', () => {
    if (wanted && doc.visibilityState === 'visible') void acquire()
  })

  return { acquire, release, supported: Boolean(api) }
}
