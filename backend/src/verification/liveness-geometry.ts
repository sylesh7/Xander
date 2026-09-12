/**
 * Active-liveness geometry — Xander V2 Phase 5.
 *
 * Pure. No database, no network, no clock. Deterministic arithmetic over
 * landmark coordinates, which is the whole point: rule 5 keeps the security
 * core auditable, so the backend verifies GEOMETRY rather than running a model
 * and trusting its opinion.
 *
 * WHAT THIS IS, PRECISELY. The frontend runs MediaPipe locally and sends the
 * resulting landmark time-series. This module decides whether that series
 * actually performed the challenge the backend issued. It is not a deepfake
 * detector, it does not prove personhood, and it must never be described as
 * either.
 *
 * WHAT IT BUYS. A client-supplied `{result: "PASS"}` boolean is forgeable with
 * one curl. Forging THIS requires synthesising a plausible landmark trajectory
 * that satisfies a randomly chosen challenge — per attempt, against a nonce the
 * attacker did not pick. That is a real cost increase, not proof of humanity,
 * and combined with a rotating lease it bounds how long any single forgery is
 * worth anything.
 *
 * LANDMARK INDICES are MediaPipe Hands', verified against two files in the
 * MediaPipe source tree rather than recalled:
 *   0 WRIST, 4 THUMB_TIP, 8 INDEX_FINGER_TIP, 12 MIDDLE_FINGER_TIP,
 *   16 RING_FINGER_TIP, 20 PINKY_TIP, with each finger's PIP two below its tip.
 */

export const HAND_LANDMARK = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5,
  INDEX_FINGER_PIP: 6,
  INDEX_FINGER_DIP: 7,
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
  MIDDLE_FINGER_PIP: 10,
  MIDDLE_FINGER_DIP: 11,
  MIDDLE_FINGER_TIP: 12,
  RING_FINGER_MCP: 13,
  RING_FINGER_PIP: 14,
  RING_FINGER_DIP: 15,
  RING_FINGER_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20,
} as const

export const HAND_LANDMARK_COUNT = 21

/** One landmark. x and y are normalised to [0, 1] against the frame. */
export interface Point {
  x: number
  y: number
  z?: number | undefined
}

/** One sampled frame of a challenge attempt. */
export interface HandFrame {
  /** Milliseconds since the challenge started, monotonically increasing. */
  tMs: number
  landmarks: Point[]
}

/** Finger tip/PIP pairs, tip first. */
const FINGERS: ReadonlyArray<readonly [number, number]> = [
  [HAND_LANDMARK.THUMB_TIP, HAND_LANDMARK.THUMB_IP],
  [HAND_LANDMARK.INDEX_FINGER_TIP, HAND_LANDMARK.INDEX_FINGER_PIP],
  [HAND_LANDMARK.MIDDLE_FINGER_TIP, HAND_LANDMARK.MIDDLE_FINGER_PIP],
  [HAND_LANDMARK.RING_FINGER_TIP, HAND_LANDMARK.RING_FINGER_PIP],
  [HAND_LANDMARK.PINKY_TIP, HAND_LANDMARK.PINKY_PIP],
]

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/**
 * Counts extended fingers in one frame.
 *
 * A finger counts as extended when its TIP is further from the wrist than its
 * PIP joint. Deliberately NOT the common "tip.y < pip.y" shortcut, which
 * assumes the hand is upright: rotate the hand ninety degrees and that test
 * silently reports a fist. Distance from the wrist is rotation-invariant, so it
 * holds however the user is holding their hand — and a challenge that only
 * works when the subject sits perfectly straight is a challenge that fails
 * honest people.
 */
export function countExtendedFingers(frame: HandFrame): number | null {
  if (frame.landmarks.length !== HAND_LANDMARK_COUNT) return null
  const wrist = frame.landmarks[HAND_LANDMARK.WRIST]
  if (!wrist) return null

  let count = 0
  for (const [tipIndex, pipIndex] of FINGERS) {
    const tip = frame.landmarks[tipIndex]
    const pip = frame.landmarks[pipIndex]
    if (!tip || !pip) return null
    if (distance(tip, wrist) > distance(pip, wrist)) count++
  }
  return count
}

/** Every coordinate must be a finite number inside the normalised frame. */
export function isWellFormedFrame(frame: HandFrame): boolean {
  if (!Number.isFinite(frame.tMs) || frame.tMs < 0) return false
  if (frame.landmarks.length !== HAND_LANDMARK_COUNT) return false
  return frame.landmarks.every(
    (p) =>
      Number.isFinite(p.x) &&
      Number.isFinite(p.y) &&
      p.x >= 0 &&
      p.x <= 1 &&
      p.y >= 0 &&
      p.y <= 1,
  )
}

export interface GestureOptions {
  /** Frames needed before a trace is worth judging at all. */
  minFrames: number
  /** Consecutive frames that must hold the target count. */
  sustainFrames: number
  /** Total span the trace must cover, milliseconds. */
  minDurationMs: number
  /** Longest the trace may run, so a stale recording cannot be replayed slowly. */
  maxDurationMs: number
  /**
   * Require the count to CHANGE at some point.
   *
   * This is the anti-still-image measure. A photograph of a hand already
   * holding three fingers yields a constant count forever, and would otherwise
   * satisfy "show three fingers" perfectly. Demanding a transition means the
   * trace has to contain motion into the pose.
   */
  requireTransition: boolean
}

export const DEFAULT_GESTURE_OPTIONS: GestureOptions = {
  minFrames: 10,
  sustainFrames: 5,
  minDurationMs: 700,
  maxDurationMs: 30_000,
  requireTransition: true,
}

export interface GestureVerdict {
  passed: boolean
  /** Machine-readable failure reason; null when passed. */
  failure: GestureFailure | null
  detail: string
  /** Observed counts, for the audit record. Never raw imagery. */
  observedCounts: number[]
}

export const GESTURE_FAILURES = {
  TOO_FEW_FRAMES: 'TOO_FEW_FRAMES',
  MALFORMED_FRAME: 'MALFORMED_FRAME',
  NON_MONOTONIC_TIME: 'NON_MONOTONIC_TIME',
  TOO_SHORT: 'DURATION_TOO_SHORT',
  TOO_LONG: 'DURATION_TOO_LONG',
  NO_TRANSITION: 'NO_TRANSITION_OBSERVED',
  TARGET_NOT_HELD: 'TARGET_POSE_NOT_HELD',
} as const
export type GestureFailure = (typeof GESTURE_FAILURES)[keyof typeof GESTURE_FAILURES]

/**
 * Did this trace perform "show exactly N fingers"?
 *
 * Every check is a reason to REJECT. There is no scoring and no partial credit:
 * an assurance step that can be argued into passing is not assurance.
 */
export function verifyFingerCountGesture(
  frames: readonly HandFrame[],
  targetCount: number,
  opts: GestureOptions = DEFAULT_GESTURE_OPTIONS,
): GestureVerdict {
  const fail = (failure: GestureFailure, detail: string, counts: number[] = []): GestureVerdict => ({
    passed: false,
    failure,
    detail,
    observedCounts: counts,
  })

  if (frames.length < opts.minFrames) {
    return fail(
      GESTURE_FAILURES.TOO_FEW_FRAMES,
      `${frames.length} frames, need ${opts.minFrames}`,
    )
  }

  const counts: number[] = []
  let previousT = -1
  for (const frame of frames) {
    if (!isWellFormedFrame(frame)) {
      return fail(GESTURE_FAILURES.MALFORMED_FRAME, 'a frame had invalid landmarks', counts)
    }
    // Strictly increasing: a trace that jumps backwards in time has been
    // stitched together, and stitching is how a replay is assembled.
    if (frame.tMs <= previousT) {
      return fail(
        GESTURE_FAILURES.NON_MONOTONIC_TIME,
        `timestamp ${frame.tMs} did not follow ${previousT}`,
        counts,
      )
    }
    previousT = frame.tMs

    const count = countExtendedFingers(frame)
    if (count === null) {
      return fail(GESTURE_FAILURES.MALFORMED_FRAME, 'could not count fingers in a frame', counts)
    }
    counts.push(count)
  }

  const duration = frames[frames.length - 1]!.tMs - frames[0]!.tMs
  if (duration < opts.minDurationMs) {
    return fail(GESTURE_FAILURES.TOO_SHORT, `${duration}ms of motion`, counts)
  }
  if (duration > opts.maxDurationMs) {
    return fail(GESTURE_FAILURES.TOO_LONG, `${duration}ms exceeds the window`, counts)
  }

  if (opts.requireTransition && new Set(counts).size < 2) {
    return fail(
      GESTURE_FAILURES.NO_TRANSITION,
      `count never changed from ${counts[0]} — consistent with a still image`,
      counts,
    )
  }

  // The target must be HELD, not merely touched in passing: a hand moving from
  // open to closed sweeps through every count on the way, so a single matching
  // frame proves nothing.
  let run = 0
  let longestRun = 0
  for (const count of counts) {
    run = count === targetCount ? run + 1 : 0
    longestRun = Math.max(longestRun, run)
  }
  if (longestRun < opts.sustainFrames) {
    return fail(
      GESTURE_FAILURES.TARGET_NOT_HELD,
      `held ${targetCount} fingers for ${longestRun} frames, need ${opts.sustainFrames}`,
      counts,
    )
  }

  return {
    passed: true,
    failure: null,
    detail: `held ${targetCount} fingers for ${longestRun} consecutive frames over ${duration}ms`,
    observedCounts: counts,
  }
}
