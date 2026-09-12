/**
 * Active-liveness geometry — pure, no infrastructure. V2 Phase 5.
 *
 * Every rejection path matters more than the acceptance path here: this is a
 * verifier, and a verifier that is easy to satisfy is worse than none, because
 * it produces confidence nobody checked.
 */
import { describe, expect, it } from 'vitest'
import {
  countExtendedFingers,
  DEFAULT_GESTURE_OPTIONS,
  GESTURE_FAILURES,
  HAND_LANDMARK,
  isWellFormedFrame,
  verifyFingerCountGesture,
  type HandFrame,
  type Point,
} from '../src/verification/liveness-geometry.js'

/**
 * Builds a synthetic hand.
 *
 * The wrist sits at the bottom centre. An EXTENDED finger puts its tip further
 * from the wrist than its PIP; a curled one puts the tip nearer. That is
 * exactly the property the verifier measures, so these fixtures exercise the
 * real rule rather than a restatement of it.
 */
function hand(extended: { thumb?: boolean; index?: boolean; middle?: boolean; ring?: boolean; pinky?: boolean }): Point[] {
  const points: Point[] = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.9 }))
  points[HAND_LANDMARK.WRIST] = { x: 0.5, y: 0.9 }

  const fingers: Array<[keyof typeof extended, number, number, number]> = [
    ['thumb', HAND_LANDMARK.THUMB_TIP, HAND_LANDMARK.THUMB_IP, 0.30],
    ['index', HAND_LANDMARK.INDEX_FINGER_TIP, HAND_LANDMARK.INDEX_FINGER_PIP, 0.42],
    ['middle', HAND_LANDMARK.MIDDLE_FINGER_TIP, HAND_LANDMARK.MIDDLE_FINGER_PIP, 0.50],
    ['ring', HAND_LANDMARK.RING_FINGER_TIP, HAND_LANDMARK.RING_FINGER_PIP, 0.58],
    ['pinky', HAND_LANDMARK.PINKY_TIP, HAND_LANDMARK.PINKY_PIP, 0.68],
  ]

  for (const [name, tipIndex, pipIndex, x] of fingers) {
    const isUp = extended[name] === true
    points[pipIndex] = { x, y: 0.70 }
    // Extended: tip beyond the PIP (further from the wrist).
    // Curled: tip pulled back toward the palm (nearer than the PIP).
    points[tipIndex] = { x, y: isUp ? 0.50 : 0.78 }
  }
  return points
}

const frame = (tMs: number, up: Parameters<typeof hand>[0]): HandFrame => ({
  tMs,
  landmarks: hand(up),
})

/** A trace that starts closed and settles on `count` fingers. */
function trace(count: number, frames = 16): HandFrame[] {
  const names = ['index', 'middle', 'ring', 'pinky', 'thumb'] as const
  const target: Parameters<typeof hand>[0] = {}
  for (let i = 0; i < count; i++) target[names[i]!] = true

  return Array.from({ length: frames }, (_, i) => {
    // First quarter closed, then held on target — a real transition.
    const isClosed = i < Math.floor(frames / 4)
    return frame(i * 100, isClosed ? {} : target)
  })
}

describe('finger counting', () => {
  it('counts a closed fist as zero', () => {
    expect(countExtendedFingers(frame(0, {}))).toBe(0)
  })

  it('counts each finger independently', () => {
    expect(countExtendedFingers(frame(0, { index: true }))).toBe(1)
    expect(countExtendedFingers(frame(0, { index: true, middle: true }))).toBe(2)
    expect(countExtendedFingers(frame(0, { index: true, middle: true, ring: true }))).toBe(3)
    expect(
      countExtendedFingers(
        frame(0, { thumb: true, index: true, middle: true, ring: true, pinky: true }),
      ),
    ).toBe(5)
  })

  it('IS ROTATION INVARIANT — a sideways hand still counts correctly', () => {
    // The reason the verifier measures distance from the wrist rather than
    // "tip is above pip". Rotating 90 degrees must not turn three fingers into
    // a fist, or the challenge only works for people sitting perfectly upright.
    const upright = frame(0, { index: true, middle: true, ring: true })
    const wrist = upright.landmarks[HAND_LANDMARK.WRIST]!
    const rotated: HandFrame = {
      tMs: 0,
      landmarks: upright.landmarks.map((p) => ({
        // Rotate every point 90 degrees about the wrist.
        x: wrist.x + (p.y - wrist.y),
        y: wrist.y - (p.x - wrist.x),
      })),
    }
    expect(countExtendedFingers(rotated)).toBe(3)
  })

  it('returns null rather than guessing on a malformed hand', () => {
    expect(countExtendedFingers({ tMs: 0, landmarks: [{ x: 0.5, y: 0.5 }] })).toBeNull()
  })
})

describe('frame validation', () => {
  it('rejects coordinates outside the normalised frame', () => {
    const bad = frame(0, {})
    bad.landmarks[0] = { x: 1.5, y: 0.5 }
    expect(isWellFormedFrame(bad)).toBe(false)
  })

  it('rejects NaN coordinates', () => {
    const bad = frame(0, {})
    bad.landmarks[0] = { x: Number.NaN, y: 0.5 }
    expect(isWellFormedFrame(bad)).toBe(false)
  })

  it('rejects a negative timestamp', () => {
    expect(isWellFormedFrame({ tMs: -1, landmarks: hand({}) })).toBe(false)
  })
})

describe('gesture verification — the accept path', () => {
  it('accepts a trace that transitions into the target and holds it', () => {
    const verdict = verifyFingerCountGesture(trace(3), 3)
    expect(verdict.passed).toBe(true)
    expect(verdict.failure).toBeNull()
  })

  it('reports observed counts for the audit record, and nothing more', () => {
    const verdict = verifyFingerCountGesture(trace(2), 2)
    expect(verdict.observedCounts.length).toBeGreaterThan(0)
    // Derived integers only — nothing here could reconstruct a hand, let alone
    // a face (section 28).
    expect(Object.keys(verdict).sort()).toEqual(['detail', 'failure', 'observedCounts', 'passed'])
  })
})

describe('gesture verification — every rejection path', () => {
  it('rejects the wrong number of fingers', () => {
    const verdict = verifyFingerCountGesture(trace(2), 4)
    expect(verdict.passed).toBe(false)
    expect(verdict.failure).toBe(GESTURE_FAILURES.TARGET_NOT_HELD)
  })

  it('REJECTS A STILL IMAGE — a constant count is not a gesture', () => {
    // The anti-photograph rule. A printed hand holding three fingers yields a
    // perfectly stable count forever and would otherwise pass outright.
    const still = Array.from({ length: 16 }, (_, i) =>
      frame(i * 100, { index: true, middle: true, ring: true }),
    )
    const verdict = verifyFingerCountGesture(still, 3)
    expect(verdict.passed).toBe(false)
    expect(verdict.failure).toBe(GESTURE_FAILURES.NO_TRANSITION)
  })

  it('rejects too few frames', () => {
    const verdict = verifyFingerCountGesture(trace(3, 4), 3)
    expect(verdict.failure).toBe(GESTURE_FAILURES.TOO_FEW_FRAMES)
  })

  it('rejects a trace that is over too fast to be a real movement', () => {
    const quick = Array.from({ length: 16 }, (_, i) =>
      frame(i, i < 4 ? {} : { index: true, middle: true, ring: true }),
    )
    expect(verifyFingerCountGesture(quick, 3).failure).toBe(GESTURE_FAILURES.TOO_SHORT)
  })

  it('rejects a trace stretched beyond the window', () => {
    const slow = Array.from({ length: 16 }, (_, i) =>
      frame(i * 10_000, i < 4 ? {} : { index: true, middle: true, ring: true }),
    )
    expect(verifyFingerCountGesture(slow, 3).failure).toBe(GESTURE_FAILURES.TOO_LONG)
  })

  it('REJECTS NON-MONOTONIC TIME — stitched traces do not pass', () => {
    // Time running backwards means frames were assembled from more than one
    // recording, which is how a replay gets built.
    const frames = trace(3)
    frames[8] = frame(10, { index: true, middle: true, ring: true })
    expect(verifyFingerCountGesture(frames, 3).failure).toBe(
      GESTURE_FAILURES.NON_MONOTONIC_TIME,
    )
  })

  it('rejects a target merely passed through, not held', () => {
    // A hand opening from 0 to 5 sweeps through 3 on the way. One matching
    // frame is not the gesture.
    const sweep: HandFrame[] = [
      frame(0, {}),
      frame(100, {}),
      frame(200, {}),
      frame(300, { index: true }),
      frame(400, { index: true, middle: true }),
      frame(500, { index: true, middle: true, ring: true }),
      frame(600, { index: true, middle: true, ring: true, pinky: true }),
      frame(700, { thumb: true, index: true, middle: true, ring: true, pinky: true }),
      frame(800, { thumb: true, index: true, middle: true, ring: true, pinky: true }),
      frame(900, { thumb: true, index: true, middle: true, ring: true, pinky: true }),
      frame(1000, { thumb: true, index: true, middle: true, ring: true, pinky: true }),
      frame(1100, { thumb: true, index: true, middle: true, ring: true, pinky: true }),
    ]
    const verdict = verifyFingerCountGesture(sweep, 3)
    expect(verdict.passed).toBe(false)
    expect(verdict.failure).toBe(GESTURE_FAILURES.TARGET_NOT_HELD)
  })

  it('rejects a malformed frame anywhere in the trace', () => {
    const frames = trace(3)
    frames[9] = { tMs: 900, landmarks: [{ x: 0.1, y: 0.1 }] }
    expect(verifyFingerCountGesture(frames, 3).failure).toBe(GESTURE_FAILURES.MALFORMED_FRAME)
  })

  it('has no partial credit — every verdict is pass or fail', () => {
    const verdict = verifyFingerCountGesture(trace(1), 5)
    expect(typeof verdict.passed).toBe('boolean')
    expect(verdict.passed).toBe(false)
  })
})

describe('gesture options are configurable, not baked in', () => {
  it('honours a relaxed transition requirement', () => {
    const still = Array.from({ length: 16 }, (_, i) =>
      frame(i * 100, { index: true, middle: true, ring: true }),
    )
    const relaxed = { ...DEFAULT_GESTURE_OPTIONS, requireTransition: false }
    expect(verifyFingerCountGesture(still, 3, relaxed).passed).toBe(true)
  })
})
