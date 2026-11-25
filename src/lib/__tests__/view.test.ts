import { describe as group, expect, it } from 'vitest'
import {
  DEFAULTS,
  chooseDevice,
  loadSettings,
  nextRotation,
  normaliseRotation,
  rememberLabel,
  saveSettings,
  transformFor,
} from '../view'

const dev = (deviceId: string, label: string) => ({ deviceId, label, groupId: '' })

group('chooseDevice', () => {
  const list = [dev('a', 'FaceTime HD'), dev('b', 'Cam Link 4K'), dev('c', 'Cam Link 4K')]

  it('prefers the remembered id', () => {
    expect(chooseDevice(list, { deviceId: 'b', label: 'FaceTime HD' })?.deviceId).toBe('b')
  })

  it('falls back to the label when the id has been revoked', () => {
    // Resetting the site's camera permission rotates every deviceId; the
    // label usually survives, so it is the second key rather than nothing.
    expect(chooseDevice(list, { deviceId: 'gone', label: 'Cam Link 4K' })?.deviceId).toBe('b')
  })

  it('takes the first device when neither matches', () => {
    expect(chooseDevice(list, { deviceId: 'gone', label: 'Also gone' })?.deviceId).toBe('a')
  })

  it('is undefined only when there are no devices', () => {
    expect(chooseDevice([], { deviceId: 'a' })).toBeUndefined()
  })
})

group('rememberLabel', () => {
  const list = [dev('a', 'FaceTime HD'), dev('b', 'Cam Link 4K')]

  it('keeps the remembered name while the list is still empty', () => {
    // Every fresh visit: no stream yet, so no names. Writing "nothing" here
    // used to erase the name before it was ever needed.
    expect(rememberLabel([], 'b', 'Cam Link 4K')).toBe('Cam Link 4K')
  })

  it('keeps it when the remembered id is not in the list', () => {
    // A permission reset rotated the ids: the name is now the only key left.
    expect(rememberLabel(list, 'gone', 'Cam Link 4K')).toBe('Cam Link 4K')
  })

  it('takes the name of the device in use once the list has it', () => {
    expect(rememberLabel(list, 'a', 'Cam Link 4K')).toBe('FaceTime HD')
  })

  it('has nothing to keep on a first visit', () => {
    expect(rememberLabel([], undefined, undefined)).toBeUndefined()
  })
})

group('rotation', () => {
  it('normalises anything to a quarter turn', () => {
    expect(normaliseRotation(0)).toBe(0)
    expect(normaliseRotation(450)).toBe(90)
    expect(normaliseRotation(-90)).toBe(270)
    expect(normaliseRotation(89)).toBe(90)
    expect(normaliseRotation('nonsense')).toBe(0)
    expect(normaliseRotation(undefined)).toBe(0)
  })

  it('cycles', () => {
    expect(nextRotation(0)).toBe(90)
    expect(nextRotation(270)).toBe(0)
  })
})

group('transformFor', () => {
  const wide = { w: 1600, h: 900 }

  it('is none when nothing is applied', () => {
    expect(transformFor(0, false, wide)).toBe('none')
  })

  it('mirrors without rotating', () => {
    expect(transformFor(0, true, wide)).toBe('scaleX(-1)')
  })

  it('scales a quarter turn to the short axis, so it is not cropped', () => {
    // A 16:9 stage rotated 90° must shrink to 9/16 or the picture's long
    // edge runs off the top and bottom.
    expect(transformFor(90, false, wide)).toBe('rotate(90deg) scale(0.563)')
  })

  it('does not scale a half turn', () => {
    expect(transformFor(180, false, wide)).toBe('rotate(180deg)')
  })

  it('keeps mirror after rotation', () => {
    expect(transformFor(270, true, wide)).toBe('rotate(270deg) scale(0.563) scaleX(-1)')
  })

  it('survives a stage with no size yet', () => {
    expect(transformFor(90, false, { w: 0, h: 0 })).toBe('rotate(90deg)')
  })
})

group('settings', () => {
  const store = () => {
    const map = new Map<string, string>()
    return {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    }
  }

  it('round-trips', () => {
    const s = store()
    saveSettings({ ...DEFAULTS, deviceId: 'a', label: 'Cam', width: 1920, height: 1080, mirror: true }, s)
    const back = loadSettings(s)
    expect(back.deviceId).toBe('a')
    expect(back.width).toBe(1920)
    expect(back.mirror).toBe(true)
  })

  it('returns defaults for an empty store', () => {
    expect(loadSettings(store())).toEqual(DEFAULTS)
  })

  it('puts the bar at the bottom, auto-hiding in full screen only, by default', () => {
    expect(DEFAULTS.edge).toBe('bottom')
    expect(DEFAULTS.autoHide).toBe('fullscreen')
  })

  it('remembers where the bar is and when it hides', () => {
    const s = store()
    saveSettings({ ...DEFAULTS, edge: 'right', autoHide: 'always' }, s)
    const back = loadSettings(s)
    expect(back.edge).toBe('right')
    expect(back.autoHide).toBe('always')
  })

  it('reads a store from before the bar could move as the old behaviour', () => {
    // Everything saved before this change: no edge, no autoHide.
    const s = store()
    s.setItem('peephole.settings.v1', JSON.stringify({ fit: 'cover', mirror: true, rotation: 90 }))
    const back = loadSettings(s)
    expect(back.edge).toBe('bottom')
    expect(back.autoHide).toBe('fullscreen')
    expect(back.fit).toBe('cover')
  })

  it('does not trust a stored edge or auto-hide either', () => {
    const s = store()
    s.setItem('peephole.settings.v1', JSON.stringify({ edge: 'diagonal', autoHide: 'sometimes' }))
    const back = loadSettings(s)
    expect(back.edge).toBe('bottom')
    expect(back.autoHide).toBe('fullscreen')
  })

  it('does not trust what it reads back', () => {
    const s = store()
    s.setItem('peephole.settings.v1', JSON.stringify({ fit: 'sideways', rotation: 37, mirror: 'yes' }))
    const back = loadSettings(s)
    expect(back.fit).toBe('contain')
    expect(back.rotation).toBe(0)
    expect(back.mirror).toBe(true)
  })

  it('shrugs off a store that throws', () => {
    const throwing = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
    }
    expect(loadSettings(throwing)).toEqual(DEFAULTS)
    expect(() => saveSettings(DEFAULTS, throwing)).not.toThrow()
  })

  it('copes with a store holding nonsense', () => {
    const s = store()
    s.setItem('peephole.settings.v1', 'not json')
    expect(loadSettings(s)).toEqual(DEFAULTS)
  })
})
