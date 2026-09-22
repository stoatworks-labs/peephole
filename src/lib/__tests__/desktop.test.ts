import { describe as group, expect, it, vi } from 'vitest'
import { blockedHint, getDesktop, startNote } from '../desktop'

/** A preload bridge, with whatever a test wants to change about it. */
function fakeBridge(over: Record<string, unknown> = {}): { peephole: Record<string, unknown> } {
  return {
    peephole: {
      platform: 'darwin',
      setFullScreen: vi.fn().mockResolvedValue(undefined),
      isFullScreen: vi.fn().mockResolvedValue(false),
      onFullScreenChange: vi.fn().mockReturnValue(7),
      offFullScreenChange: vi.fn(),
      keepDisplayAwake: vi.fn().mockResolvedValue(true),
      cameraStatus: vi.fn().mockResolvedValue('granted'),
      requestCameraAccess: vi.fn().mockResolvedValue(true),
      ...over,
    },
  }
}

group('getDesktop', () => {
  it('is null in a browser, which is what keeps the hosted build unchanged', () => {
    expect(getDesktop({})).toBeNull()
    expect(getDesktop(undefined)).toBeNull()
  })

  it('refuses a half-built bridge rather than claiming desktop behaviour', () => {
    // A preload and a renderer from different builds. Half a bridge would fail
    // later and somewhere less obvious, with the page already having decided it
    // is an app.
    const partial = fakeBridge()
    delete partial.peephole.keepDisplayAwake
    expect(getDesktop(partial)).toBeNull()
  })

  it('reads the platform, and does not pass an unrecognised one through', () => {
    expect(getDesktop(fakeBridge())?.platform).toBe('darwin')
    expect(getDesktop(fakeBridge({ platform: 'sunos' }))?.platform).toBe('unknown')
    expect(getDesktop(fakeBridge({ platform: undefined }))?.platform).toBe('unknown')
  })

  it('turns the subscription token back into an unsubscribe function', () => {
    const scope = fakeBridge()
    const desktop = getDesktop(scope)!
    const stop = desktop.onFullScreenChange(() => {})
    expect(scope.peephole.onFullScreenChange).toHaveBeenCalled()
    expect(scope.peephole.offFullScreenChange).not.toHaveBeenCalled()
    stop()
    expect(scope.peephole.offFullScreenChange).toHaveBeenCalledWith(7)
  })

  it('normalises a camera status it does not recognise', async () => {
    const desktop = getDesktop(fakeBridge({ cameraStatus: vi.fn().mockResolvedValue('weird') }))!
    await expect(desktop.cameraStatus()).resolves.toBe('unknown')
  })

  it('passes a status it does recognise straight through', async () => {
    const desktop = getDesktop(fakeBridge({ cameraStatus: vi.fn().mockResolvedValue('denied') }))!
    await expect(desktop.cameraStatus()).resolves.toBe('denied')
  })
})

group('blockedHint', () => {
  // The whole point of the platform being plumbed through: an app has no
  // address bar, so the browser's advice is the one thing guaranteed to be
  // useless in it.
  it('sends a browser to the padlock and an app to the operating system', () => {
    expect(blockedHint(null)).toMatch(/address bar/)
    expect(blockedHint('darwin')).toMatch(/System Settings/)
    expect(blockedHint('darwin')).not.toMatch(/address bar/)
    expect(blockedHint('win32')).toMatch(/Settings ▸ Privacy/)
    expect(blockedHint('linux')).toMatch(/video/)
    expect(blockedHint('unknown')).not.toMatch(/address bar/)
  })
})

group('startNote', () => {
  it('says who is about to ask for the camera', () => {
    expect(startNote(null)).toMatch(/browser will ask/)
    expect(startNote('darwin')).toMatch(/system will ask/)
    expect(startNote('win32')).toMatch(/system will ask/)
  })

  it('does not promise a prompt on Linux, where there is none to raise', () => {
    expect(startNote('linux')).not.toMatch(/will ask/)
  })
})
