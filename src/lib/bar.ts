/**
 * Where the control bar lives, and when it gets out of the way.
 *
 * The bar can sit along any edge of the screen, because a monitor is not always
 * watched from the same side: a portrait screen wants it down the side, and a
 * picture whose bottom edge matters (lower thirds, a timecode burn-in) wants it
 * along the top.
 *
 * It is out of the way in one of two ways, and they are different on purpose:
 *
 * - **Auto-hide** fades it after a few seconds of stillness and brings it back
 *   on any movement — what full screen has always done, and still the default
 *   there. A nudge of the mouse is all it costs.
 * - **Stowed** is the Hide button: gone until asked for. Moving the mouse does
 *   not bring it back, because a stowed bar is one the operator wanted gone and
 *   the mouse on a show machine gets knocked. Pushing the pointer against the
 *   bar's own edge, clicking the picture, or H brings it back.
 */

export type Edge = 'top' | 'bottom' | 'left' | 'right'
export type AutoHide = 'never' | 'fullscreen' | 'always'

export const EDGES: readonly Edge[] = ['top', 'bottom', 'left', 'right']
export const AUTO_HIDES: readonly AutoHide[] = ['never', 'fullscreen', 'always']

/** How far in from the bar's edge the pointer brings a stowed bar back, in CSS px. */
export const REVEAL_ZONE = 24

export function normaliseEdge(e: unknown): Edge {
  return EDGES.includes(e as Edge) ? (e as Edge) : 'bottom'
}

export function normaliseAutoHide(a: unknown): AutoHide {
  return AUTO_HIDES.includes(a as AutoHide) ? (a as AutoHide) : 'fullscreen'
}

export function isVertical(edge: Edge): boolean {
  return edge === 'left' || edge === 'right'
}

/** Whether the bar fades on its own, given the setting and the window's state. */
export function autoHides(mode: AutoHide, fullscreen: boolean): boolean {
  return mode === 'always' || (mode === 'fullscreen' && fullscreen)
}

/**
 * Whether the bar is out of sight.
 *
 * `held` is anything that must keep it up whatever the timer says: the pointer
 * resting on it, its menu open, a drag in progress. Without that the bar fades
 * out from under a pointer that is about to click it.
 */
export function barHidden(s: {
  stowed: boolean
  autoHide: AutoHide
  fullscreen: boolean
  idle: boolean
  held: boolean
}): boolean {
  if (s.stowed) return true
  if (s.held) return false
  return autoHides(s.autoHide, s.fullscreen) && s.idle
}

/** The edge nearest a point: where a dragged bar lands when it is let go. */
export function nearestEdge(x: number, y: number, w: number, h: number): Edge {
  const d: [Edge, number][] = [
    ['top', y],
    ['bottom', h - y],
    ['left', x],
    ['right', w - x],
  ]
  // Raw distance, not distance as a share of the screen: on a wide screen
  // "the side I let go nearest" is what the eye sees.
  return d.reduce((best, cur) => (cur[1] < best[1] ? cur : best))[0]
}

/** Whether a point is in the strip along `edge` that brings a stowed bar back. */
export function atEdge(edge: Edge, x: number, y: number, w: number, h: number, zone = REVEAL_ZONE): boolean {
  switch (edge) {
    case 'top':
      return y <= zone
    case 'bottom':
      return y >= h - zone
    case 'left':
      return x <= zone
    case 'right':
      return x >= w - zone
  }
}

/**
 * One pointer movement against a stowed bar.
 *
 * The Hide button is itself inside the reveal strip — the bar is only a few
 * dozen pixels deep — so a bar that came back whenever the pointer was in the
 * strip would reappear on the first twitch after it was hidden. The strip only
 * counts once the pointer has been outside it since the bar was stowed:
 * `armed` starts false on every stow.
 */
export function edgeReveal(armed: boolean, inZone: boolean): { armed: boolean; reveal: boolean } {
  if (!inZone) return { armed: true, reveal: false }
  return { armed, reveal: armed }
}

type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }

/**
 * Where the bar's menu opens, as offsets inside the stage.
 *
 * It opens away from the edge the bar is on — up from a bottom bar, out to the
 * side from a side bar — clear of the bar, and lined up with the button that
 * opened it. It is placed against the stage rather than inside the bar because
 * a side bar scrolls when the window is short, and a scrolling box clips
 * anything that hangs out of it.
 */
export function menuPlacement(
  edge: Edge,
  button: Rect,
  bar: Rect,
  stage: Rect,
  gap = 8,
): { top?: number; bottom?: number; left?: number; right?: number } {
  const right = stage.right - button.right
  const bottom = stage.bottom - button.bottom
  switch (edge) {
    case 'bottom':
      return { bottom: stage.bottom - bar.top + gap, right }
    case 'top':
      return { top: bar.bottom - stage.top + gap, right }
    case 'left':
      return { left: bar.right - stage.left + gap, bottom }
    case 'right':
      return { right: stage.right - bar.left + gap, bottom }
  }
}

/** The arrow keys on the bar's handle: the edge in that direction. */
export function edgeForKey(key: string): Edge | undefined {
  switch (key) {
    case 'ArrowUp':
      return 'top'
    case 'ArrowDown':
      return 'bottom'
    case 'ArrowLeft':
      return 'left'
    case 'ArrowRight':
      return 'right'
    default:
      return undefined
  }
}
