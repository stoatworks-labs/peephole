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
