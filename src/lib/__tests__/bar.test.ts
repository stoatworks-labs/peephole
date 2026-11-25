import { describe as group, expect, it } from 'vitest'
import {
  atEdge,
  autoHides,
  barHidden,
  edgeForKey,
  edgeReveal,
  isVertical,
  menuPlacement,
  nearestEdge,
  normaliseAutoHide,
  normaliseEdge,
} from '../bar'

group('normalising what was stored', () => {
  it('keeps a real edge and defaults anything else to the bottom', () => {
    expect(normaliseEdge('left')).toBe('left')
    expect(normaliseEdge('sideways')).toBe('bottom')
    expect(normaliseEdge(undefined)).toBe('bottom')
  })

  it('keeps a real auto-hide mode and defaults anything else to full screen only', () => {
    expect(normaliseAutoHide('always')).toBe('always')
    expect(normaliseAutoHide('never')).toBe('never')
    expect(normaliseAutoHide(true)).toBe('fullscreen')
    expect(normaliseAutoHide(undefined)).toBe('fullscreen')
  })

  it('knows the side edges are the vertical ones', () => {
    expect(isVertical('left')).toBe(true)
    expect(isVertical('right')).toBe(true)
    expect(isVertical('top')).toBe(false)
    expect(isVertical('bottom')).toBe(false)
  })
})

group('autoHides', () => {
  it('in full screen only, by default', () => {
    expect(autoHides('fullscreen', true)).toBe(true)
    expect(autoHides('fullscreen', false)).toBe(false)
  })

  it('always and never mean what they say, in or out of full screen', () => {
    expect(autoHides('always', false)).toBe(true)
    expect(autoHides('never', true)).toBe(false)
  })
})

group('barHidden', () => {
  const base = { stowed: false, autoHide: 'fullscreen' as const, fullscreen: true, idle: false, held: false }

  it('is shown while there is movement', () => {
    expect(barHidden(base)).toBe(false)
  })

  it('fades after stillness when auto-hiding', () => {
    expect(barHidden({ ...base, idle: true })).toBe(true)
  })

  it('stays when auto-hide does not apply, however still', () => {
    expect(barHidden({ ...base, idle: true, fullscreen: false })).toBe(false)
    expect(barHidden({ ...base, idle: true, autoHide: 'never' })).toBe(false)
  })

  it('does not fade out from under a pointer resting on it', () => {
    expect(barHidden({ ...base, idle: true, held: true })).toBe(false)
  })

  it('is hidden when stowed, movement or not', () => {
    expect(barHidden({ ...base, stowed: true, fullscreen: false, autoHide: 'never' })).toBe(true)
    expect(barHidden({ ...base, stowed: true, held: true })).toBe(true)
  })
})

group('nearestEdge', () => {
  const w = 1920
  const h = 1080

  it('lands on the edge the pointer is let go nearest', () => {
    expect(nearestEdge(960, 20, w, h)).toBe('top')
    expect(nearestEdge(960, 1070, w, h)).toBe('bottom')
    expect(nearestEdge(30, 540, w, h)).toBe('left')
    expect(nearestEdge(1900, 540, w, h)).toBe('right')
  })

  it('goes by distance in pixels, not share of the screen', () => {
    // 300 px from the left, 400 px from the top: the left edge, though the
    // point is a smaller fraction of the height than of the width away.
    expect(nearestEdge(300, 400, w, h)).toBe('left')
  })
})

group('atEdge', () => {
  const w = 1280
  const h = 720

  it('is the strip along the bar’s own edge', () => {
    expect(atEdge('bottom', 640, 710, w, h)).toBe(true)
    expect(atEdge('bottom', 640, 600, w, h)).toBe(false)
    expect(atEdge('top', 640, 4, w, h)).toBe(true)
    expect(atEdge('left', 0, 360, w, h)).toBe(true)
    expect(atEdge('right', 1279, 360, w, h)).toBe(true)
    expect(atEdge('right', 1100, 360, w, h)).toBe(false)
  })

  it('only that edge: the top of the screen does not bring back a bottom bar', () => {
    expect(atEdge('bottom', 640, 0, w, h)).toBe(false)
  })
})

group('edgeReveal', () => {
  it('ignores the strip until the pointer has left it once', () => {
    // Just stowed, pointer still on the Hide button, inside the strip.
    let s = edgeReveal(false, true)
    expect(s).toEqual({ armed: false, reveal: false })
    // Out into the picture: armed.
    s = edgeReveal(s.armed, false)
    expect(s).toEqual({ armed: true, reveal: false })
    // Back against the edge: the bar comes back.
    expect(edgeReveal(s.armed, true)).toEqual({ armed: true, reveal: true })
  })
})

group('edgeForKey', () => {
  it('maps the arrows to edges and nothing else', () => {
    expect(edgeForKey('ArrowUp')).toBe('top')
    expect(edgeForKey('ArrowDown')).toBe('bottom')
    expect(edgeForKey('ArrowLeft')).toBe('left')
    expect(edgeForKey('ArrowRight')).toBe('right')
    expect(edgeForKey('h')).toBeUndefined()
  })
})

group('menuPlacement', () => {
  const rect = (left: number, top: number, width: number, height: number) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  })
  const stage = rect(0, 0, 1000, 600)
  const button = (edge: 'top' | 'bottom' | 'left' | 'right') =>
    ({
      bottom: rect(900, 560, 50, 30),
      top: rect(900, 10, 50, 30),
      left: rect(20, 550, 100, 30),
      right: rect(880, 550, 100, 30),
    })[edge]

  it('opens upwards from a bottom bar, right-aligned with its button', () => {
    expect(menuPlacement('bottom', button('bottom'), rect(0, 550, 1000, 50), stage)).toEqual({ bottom: 58, right: 50 })
  })

  it('opens downwards from a top bar', () => {
    expect(menuPlacement('top', button('top'), rect(0, 0, 1000, 50), stage)).toEqual({ top: 58, right: 50 })
  })

  it('opens out to the side from a side bar, bottom-aligned with its button', () => {
    expect(menuPlacement('left', button('left'), rect(0, 0, 256, 600), stage)).toEqual({ left: 264, bottom: 20 })
    expect(menuPlacement('right', button('right'), rect(744, 0, 256, 600), stage)).toEqual({ right: 264, bottom: 20 })
  })

  it('is measured inside the stage, wherever the stage is on the page', () => {
    const offset = rect(100, 50, 1000, 600)
    const b = rect(1000, 610, 50, 30)
    expect(menuPlacement('bottom', b, rect(100, 600, 1000, 50), offset)).toEqual({ bottom: 58, right: 50 })
  })
})
