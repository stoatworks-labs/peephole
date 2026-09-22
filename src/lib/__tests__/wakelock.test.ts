import { describe as group, expect, it, vi } from 'vitest'
import { createWakeLock } from '../wakelock'

type Listener = () => void

function fakeDoc(): Document & { fire(): void; visibilityState: string } {
  const listeners: Record<string, Listener[]> = {}
  const doc = {
    visibilityState: 'visible',
    addEventListener: (t: string, f: Listener) => {
      ;(listeners[t] ||= []).push(f)
    },
    fire: () => listeners['visibilitychange']?.forEach((f) => f()),
  }
  return doc as unknown as Document & { fire(): void; visibilityState: string }
}

group('createWakeLock', () => {
  it('reports honestly when the browser has no wake lock', async () => {
    const lock = createWakeLock({} as Navigator, fakeDoc())
    expect(lock.supported).toBe(false)
    // The page must still work — a missing lock is a caption, not an error.
    await expect(lock.acquire()).resolves.toBe(false)
    await expect(lock.release()).resolves.toBeUndefined()
  })

  it('takes the lock once and reuses it', async () => {
    const request = vi.fn().mockResolvedValue({ released: false, release: vi.fn() })
    const lock = createWakeLock({ wakeLock: { request } } as unknown as Navigator, fakeDoc())
    await lock.acquire()
    await lock.acquire()
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('re-takes it when the tab comes back, because the browser drops it', async () => {
    const request = vi.fn().mockResolvedValue({ released: true, release: vi.fn() })
    const doc = fakeDoc()
    const lock = createWakeLock({ wakeLock: { request } } as unknown as Navigator, doc)
    await lock.acquire()
    expect(request).toHaveBeenCalledTimes(1)
    doc.fire()
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(2)
  })

  it('does not re-take it after release', async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const request = vi.fn().mockResolvedValue({ released: false, release })
    const doc = fakeDoc()
    const lock = createWakeLock({ wakeLock: { request } } as unknown as Navigator, doc)
    await lock.acquire()
    await lock.release()
    doc.fire()
    await Promise.resolve()
    expect(request).toHaveBeenCalledTimes(1)
    expect(release).toHaveBeenCalled()
  })

  it('survives a denied request', async () => {
    const request = vi.fn().mockRejectedValue(new Error('denied'))
    const lock = createWakeLock({ wakeLock: { request } } as unknown as Navigator, fakeDoc())
    await expect(lock.acquire()).resolves.toBe(false)
  })
})

group('createWakeLock, in the desktop app', () => {
  it('uses the power-save blocker even where the browser API is missing', async () => {
    const keepDisplayAwake = vi.fn().mockResolvedValue(true)
    const lock = createWakeLock({} as Navigator, fakeDoc(), { keepDisplayAwake })
    // No caption about the screen possibly sleeping: on the desktop it will not.
    expect(lock.supported).toBe(true)
    await expect(lock.acquire()).resolves.toBe(true)
    expect(keepDisplayAwake).toHaveBeenCalledWith(true)
    await lock.release()
    expect(keepDisplayAwake).toHaveBeenLastCalledWith(false)
  })

  it('is not re-taken when the window hides, because it was never dropped', async () => {
    const keepDisplayAwake = vi.fn().mockResolvedValue(true)
    const doc = fakeDoc()
    const lock = createWakeLock({} as Navigator, doc, { keepDisplayAwake })
    await lock.acquire()
    doc.fire()
    await Promise.resolve()
    // The whole reason the desktop path exists: powerSaveBlocker belongs to the
    // process, not to a visible document, so the browser's re-take dance is
    // both unnecessary and absent.
    expect(keepDisplayAwake).toHaveBeenCalledTimes(1)
  })

  it('survives a bridge that throws', async () => {
    const keepDisplayAwake = vi.fn().mockRejectedValue(new Error('gone'))
    const lock = createWakeLock({} as Navigator, fakeDoc(), { keepDisplayAwake })
    await expect(lock.acquire()).resolves.toBe(false)
    await expect(lock.release()).resolves.toBeUndefined()
  })
})
