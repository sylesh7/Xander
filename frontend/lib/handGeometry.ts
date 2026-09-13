/**
 * Client-side hand geometry helpers for the liveness overlay.
 *
 * Non-negotiable (frontend spec §7.7 rule 5): "Do not gate on your own
 * client-side count. Show it for feedback; the server's verdict is the only
 * one that counts. A client that pre-judges is a client an attacker can
 * patch." Everything here is cosmetic — it drives the overlay colour and the
 * live number shown to the user, never the pass/fail decision, and never
 * what's transmitted (the raw landmarks are sent unmodified).
 */

export interface Landmark {
  x: number
  y: number
  z?: number
}

/** MediaPipe's fixed 21-point index order — the backend depends on this exactly. */
export const LANDMARK_NAMES = [
  'WRIST',
  'THUMB_CMC', 'THUMB_MCP', 'THUMB_IP', 'THUMB_TIP',
  'INDEX_MCP', 'INDEX_PIP', 'INDEX_DIP', 'INDEX_TIP',
  'MIDDLE_MCP', 'MIDDLE_PIP', 'MIDDLE_DIP', 'MIDDLE_TIP',
  'RING_MCP', 'RING_PIP', 'RING_DIP', 'RING_TIP',
  'PINKY_MCP', 'PINKY_PIP', 'PINKY_DIP', 'PINKY_TIP',
] as const

/** Standard MediaPipe hand skeleton bones, by landmark index — for the overlay only. */
export const HAND_CONNECTIONS: [number, number][] = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20],
  [0, 17],
]

/**
 * A rough, cosmetic finger count: a non-thumb finger is "extended" when its
 * tip sits further from the wrist than its PIP joint does; the thumb is
 * extended when its tip sits further from the pinky's MCP than the thumb's
 * own MCP does (robust to either hand's mirrored geometry, unlike a simple
 * x-coordinate comparison). Imprecision here is fine — see the module doc.
 */
export function estimateFingerCount(landmarks: Landmark[]): number {
  if (landmarks.length !== 21) return 0
  const dist = (a: Landmark, b: Landmark) => Math.hypot(a.x - b.x, a.y - b.y)
  const wrist = landmarks[0]!

  let count = 0

  const thumbTip = landmarks[4]!
  const thumbMcp = landmarks[2]!
  const pinkyMcp = landmarks[17]!
  if (dist(thumbTip, pinkyMcp) > dist(thumbMcp, pinkyMcp) * 1.15) count++

  const fingers: [number, number][] = [
    [8, 6], // index tip, pip
    [12, 10], // middle
    [16, 14], // ring
    [20, 18], // pinky
  ]
  for (const [tipIdx, pipIdx] of fingers) {
    const tip = landmarks[tipIdx]!
    const pip = landmarks[pipIdx]!
    if (dist(tip, wrist) > dist(pip, wrist) * 1.1) count++
  }

  return count
}
