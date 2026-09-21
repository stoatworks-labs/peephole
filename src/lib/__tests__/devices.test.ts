import { describe as group, expect, it } from 'vitest'
import {
  LADDER,
  actualOf,
  constraintsFor,
  describe,
  isDownscaled,
  modesFromCapabilities,
} from '../devices'

group('constraintsFor', () => {
  it('pins the device exactly and the size only as an ideal', () => {
    const c = constraintsFor('abc', { width: 1920, height: 1080 })
    const v = c.video as MediaTrackConstraints
    // Exact: being handed a different camera than the one chosen is worse
    // than an error, because nothing on screen would say so.
    expect(v.deviceId).toEqual({ exact: 'abc' })
    // Ideal: a card that cannot do 1080p should still give a picture.
    expect(v.width).toEqual({ ideal: 1920 })
    expect(v.height).toEqual({ ideal: 1080 })
  })

  it('carries a frame rate only when one was asked for', () => {
    const without = constraintsFor('abc', { width: 1280, height: 720 }).video as MediaTrackConstraints
    expect(without.frameRate).toBeUndefined()
    const with60 = constraintsFor('abc', { width: 1280, height: 720, fps: 60 }).video as MediaTrackConstraints
    expect(with60.frameRate).toEqual({ ideal: 60 })
  })

  it('falls back to plain video:true with no device and no mode', () => {
    expect(constraintsFor(undefined, undefined)).toEqual({ video: true, audio: false })
  })

  it('never asks for audio', () => {
    expect(constraintsFor('abc', { width: 640, height: 480 }).audio).toBe(false)
  })
})

group('modesFromCapabilities', () => {
  it('uses the whole ladder when the browser reports nothing', () => {
    expect(modesFromCapabilities(undefined)).toEqual(LADDER)
  })

  it('drops modes above what the device can do', () => {
    const modes = modesFromCapabilities({ width: { max: 1920 }, height: { max: 1080 } } as MediaTrackCapabilities)
    expect(modes.every((m) => m.width <= 1920 && m.height <= 1080)).toBe(true)
    expect(modes).toContainEqual({ width: 1920, height: 1080 })
    expect(modes).not.toContainEqual({ width: 3840, height: 2160 })
  })

  it('offers a maximum that is not on the ladder, at the top', () => {
    const modes = modesFromCapabilities({ width: { max: 1600 }, height: { max: 1200 } } as MediaTrackCapabilities)
    expect(modes[0]).toEqual({ width: 1600, height: 1200 })
  })

  it('keeps the ladder when the capability has no max', () => {
    expect(modesFromCapabilities({ width: {}, height: {} } as MediaTrackCapabilities)).toEqual(LADDER)
  })
})

group('actualOf and describe', () => {
  const streamWith = (settings: MediaTrackSettings, label = 'Cam') =>
    ({ getVideoTracks: () => [{ getSettings: () => settings, label }] }) as unknown as MediaStream

  it('reads back what the track settled on, rounding the frame rate', () => {
    const a = actualOf(streamWith({ width: 1920, height: 1080, frameRate: 29.97, deviceId: 'x' }))
    expect(a).toEqual({ width: 1920, height: 1080, fps: 30, deviceId: 'x', label: 'Cam' })
  })

  it('is null without a video track', () => {
    expect(actualOf({ getVideoTracks: () => [] } as unknown as MediaStream)).toBeNull()
    expect(actualOf(null)).toBeNull()
  })

  it('describes a size with and without a rate', () => {
    expect(describe({ width: 1920, height: 1080, fps: 60 })).toBe('1920 × 1080 at 60fps')
    expect(describe({ width: 1280, height: 720 })).toBe('1280 × 720')
    expect(describe(null)).toBe('—')
  })
})

group('isDownscaled', () => {
  it('flags a capture card that quietly gave VGA', () => {
    expect(isDownscaled({ width: 1920, height: 1080 }, { width: 640, height: 480 })).toBe(true)
  })

  it('ignores the few pixels a sensor or crop moves', () => {
    expect(isDownscaled({ width: 1920, height: 1080 }, { width: 1918, height: 1080 })).toBe(false)
    expect(isDownscaled({ width: 1920, height: 1080 }, { width: 1920, height: 1080 })).toBe(false)
  })

  it('says nothing when no mode was asked for', () => {
    expect(isDownscaled(undefined, { width: 640, height: 480 })).toBe(false)
  })
})
