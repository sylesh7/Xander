'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Hand, ScanFace, CircleHelp } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type { LivenessCompleteResponse, LivenessStartResponse } from '@/lib/types'
import { estimateFingerCount, HAND_CONNECTIONS, type Landmark } from '@/lib/handGeometry'
import { ReasonPanel } from './ReasonPanel'

/**
 * §7 of the frontend spec, verbatim on the constraints that matter:
 * - The camera image never leaves the browser. Only {x,y,z?} coordinates are
 *   transmitted — sending a frame, a data URL, or a crop is a spec
 *   violation, not an optimisation.
 * - Never synthesise landmarks. Never scale coordinates. Never reuse a
 *   challengeId or nonce. Never gate on the client's own count — it's
 *   feedback only, the server's verdict is the only one that counts.
 */

type Phase =
  | 'permission-not-asked'
  | 'permission-denied'
  | 'no-camera'
  | 'model-loading'
  | 'model-failed'
  | 'ready'
  | 'active'
  | 'expired'
  | 'submitting'
  | 'passed'
  | 'failed'

type SubPhase = 'lead-in' | 'searching' | 'counting' | 'holding'

const HOLD_MS = 1600
const CAPTURE_INTERVAL_MS = 100 // ~10Hz per spec
const LEAD_IN_MS = 1400
const MAX_FRAMES = 600

interface CapturedFrame {
  tMs: number
  landmarks: Landmark[]
}

export function LivenessChallenge({
  actorId,
  agentId,
  onPassed,
  onFailed,
}: {
  actorId: string
  agentId?: string
  onPassed?: (challengeId: string) => void
  onFailed?: (reason: string | null | undefined, failureCode: string | null | undefined) => void
}) {
  const [phase, setPhase] = useState<Phase>('permission-not-asked')
  const [subPhase, setSubPhase] = useState<SubPhase>('lead-in')
  const [liveCount, setLiveCount] = useState(0)
  const [errorDetail, setErrorDetail] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<LivenessStartResponse | null>(null)
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [result, setResult] = useState<LivenessCompleteResponse | null>(null)
  const [framesCaptured, setFramesCaptured] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const landmarkerRef = useRef<import('@mediapipe/tasks-vision').HandLandmarker | null>(null)
  const rafRef = useRef<number | null>(null)
  const framesRef = useRef<CapturedFrame[]>([])
  const captureStartRef = useRef(0)
  const lastCaptureRef = useRef(0)
  const holdStartRef = useRef<number | null>(null)
  const challengeRef = useRef<LivenessStartResponse | null>(null)
  const sessionBindingRef = useRef<string>('')
  const submittingRef = useRef(false)

  const stopLoop = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  // Release the camera and the MediaPipe landmarker on unmount — otherwise
  // navigating away mid-challenge leaves the camera light on and holds the
  // WASM/GPU resources open indefinitely.
  useEffect(
    () => () => {
      stopLoop()
      streamRef.current?.getTracks().forEach((t) => t.stop())
      landmarkerRef.current?.close()
    },
    [stopLoop],
  )

  async function enableCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user' } })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setPhase('model-loading')
      await loadModel()
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      setPhase(name === 'NotFoundError' ? 'no-camera' : 'permission-denied')
    }
  }

  async function loadModel() {
    try {
      const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision')
      const vision = await FilesetResolver.forVisionTasks('/wasm')
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: { modelAssetPath: '/models/hand_landmarker.task', delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      })
      landmarkerRef.current = landmarker
      setPhase('ready')
    } catch (err) {
      setErrorDetail(err instanceof Error ? err.message : 'Unknown error loading the vision model.')
      setPhase('model-failed')
    }
  }

  async function beginChallenge() {
    setErrorDetail(null)
    setResult(null)
    framesRef.current = []
    setFramesCaptured(0)
    holdStartRef.current = null
    sessionBindingRef.current = crypto.randomUUID()

    try {
      const { status, data } = await consoleApi.post<LivenessStartResponse & { message?: string }>('/v2/verification/liveness/start', {
        actorId,
        ...(agentId ? { agentId } : {}),
        sessionBinding: sessionBindingRef.current,
      })
      if (status !== 201) {
        setErrorDetail(data.message ?? `Could not start a challenge (${status}).`)
        return
      }
      challengeRef.current = data
      setChallenge(data)
      captureStartRef.current = performance.now()
      lastCaptureRef.current = 0
      setSubPhase('lead-in')
      setPhase('active')
      setTimeout(() => setSubPhase((p) => (p === 'lead-in' ? 'searching' : p)), LEAD_IN_MS)
      rafRef.current = requestAnimationFrame(loop)
    } catch (err) {
      setErrorDetail(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    }
  }

  /**
   * Reads `challengeRef`, not the `challenge` state variable: this callback
   * is scheduled via `requestAnimationFrame` synchronously inside
   * `beginChallenge`, in the same tick as `setChallenge` — React hasn't
   * re-rendered yet, so a closure over the state variable would still see
   * the previous (null) value and bail out on its very first frame. The ref
   * is written synchronously alongside the state, so it's never stale.
   */
  const loop = useCallback(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    const landmarker = landmarkerRef.current
    const challenge = challengeRef.current
    if (!video || !canvas || !landmarker || !challenge) return

    if (Date.now() > new Date(challenge.expiresAt).getTime()) {
      stopLoop()
      setPhase('expired')
      return
    }

    const now = performance.now()
    const result = landmarker.detectForVideo(video, now)
    const hand = result.landmarks[0] as Landmark[] | undefined

    const ctx = canvas.getContext('2d')
    if (ctx) {
      canvas.width = video.videoWidth || canvas.width
      canvas.height = video.videoHeight || canvas.height
      ctx.clearRect(0, 0, canvas.width, canvas.height)
    }

    if (!hand) {
      setLiveCount(0)
      holdStartRef.current = null
      setSubPhase((p) => (p === 'lead-in' ? p : 'searching'))
    } else {
      const count = estimateFingerCount(hand)
      setLiveCount(count)

      const nowMs = now - captureStartRef.current
      if (nowMs - lastCaptureRef.current >= CAPTURE_INTERVAL_MS && framesRef.current.length < MAX_FRAMES) {
        lastCaptureRef.current = nowMs
        framesRef.current.push({ tMs: Math.round(nowMs), landmarks: hand.map((p) => ({ x: p.x, y: p.y, z: p.z })) })
        setFramesCaptured(framesRef.current.length)
      }

      if (ctx) drawOverlay(ctx, canvas.width, canvas.height, hand, count === challenge.target)

      if (count === challenge.target) {
        setSubPhase('holding')
        if (holdStartRef.current === null) holdStartRef.current = now
        if (now - holdStartRef.current >= HOLD_MS && !submittingRef.current) {
          submittingRef.current = true
          stopLoop()
          void submit()
          return
        }
      } else {
        holdStartRef.current = null
        setSubPhase((p) => (p === 'lead-in' ? p : 'counting'))
      }
    }

    rafRef.current = requestAnimationFrame(loop)
  }, [stopLoop])

  /** Also reads `challengeRef` rather than the `challenge` state, for the same reason `loop` does. */
  async function submit() {
    setPhase('submitting')
    try {
      const active = challengeRef.current!
      const { data } = await consoleApi.post<LivenessCompleteResponse>('/v2/verification/liveness/complete', {
        challengeId: active.challengeId,
        nonce: active.nonce,
        sessionBinding: sessionBindingRef.current,
        cvVersion: 'mediapipe-tasks-vision@1.0.1',
        frames: framesRef.current,
      })
      setResult(data)
      if (data.passed) {
        setPhase('passed')
        onPassed?.(data.challengeId)
      } else {
        setPhase('failed')
        onFailed?.(data.reason, data.failureCode)
      }
    } catch (err) {
      setErrorDetail(err instanceof ApiError ? err.message : 'Submission failed — the request never completed.')
      setPhase('failed')
    } finally {
      submittingRef.current = false
    }
  }

  function retry() {
    stopLoop()
    submittingRef.current = false
    setChallenge(null)
    setResult(null)
    setErrorDetail(null)
    setLiveCount(0)
    void beginChallenge()
  }

  // Countdown ticker while a challenge is live.
  useEffect(() => {
    if (phase !== 'active' || !challenge) {
      setSecondsLeft(null)
      return
    }
    const id = setInterval(() => {
      const left = Math.max(0, Math.round((new Date(challenge.expiresAt).getTime() - Date.now()) / 1000))
      setSecondsLeft(left)
    }, 250)
    return () => clearInterval(id)
  }, [phase, challenge])

  const cameraLive = phase !== 'permission-not-asked' && phase !== 'permission-denied' && phase !== 'no-camera'

  return (
    <div className="mx-auto max-w-[560px]">
      <div className="relative mx-auto mb-4 aspect-[4/3] w-full overflow-hidden border border-rule bg-paper-2">
        <video ref={videoRef} muted playsInline className="h-full w-full -scale-x-100 object-cover" />
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full -scale-x-100" />

        {phase === 'permission-not-asked' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-paper-2 p-6 text-center">
            <ScanFace size={32} strokeWidth={1.25} className="text-faint" />
            <p className="m-0 max-w-[36ch] text-[0.86rem] text-dim">
              This challenge runs entirely in your browser. Only 21 hand-joint coordinates per frame are ever sent —
              never an image.
            </p>
            <button
              type="button"
              onClick={() => void enableCamera()}
              className="border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase"
            >
              Enable camera
            </button>
          </div>
        ) : null}

        {phase === 'model-loading' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-paper-2/90">
            <div className="h-6 w-6 animate-spin border-2 border-ink border-t-transparent" />
            <p className="m-0 font-tele text-[0.72rem] tracking-[0.12em] text-dim uppercase">Loading vision model</p>
          </div>
        ) : null}

        {phase === 'active' && subPhase === 'lead-in' ? (
          <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
            <span className="border border-hard bg-paper px-3 py-1.5 font-shout text-[1.1rem] uppercase text-ink">Make a fist</span>
          </div>
        ) : null}

        {phase === 'active' && subPhase !== 'lead-in' ? (
          <div className="pointer-events-none absolute bottom-0 left-0 h-1 bg-acid transition-[width]" style={{ width: `${Math.min(100, (framesCaptured / 20) * 100)}%` }} />
        ) : null}
      </div>

      {cameraLive ? (
        <p className="mb-4 text-center font-tele text-[0.66rem] tracking-[0.14em] text-dim uppercase">
          Landmarks only · no image leaves this device
        </p>
      ) : null}

      {phase === 'permission-denied' ? (
        <ReasonPanel
          outcome="Camera denied"
          summary="Camera permission was refused. This blocks active liveness, not World ID — a World-only assurance lease (shorter) is still available."
          next="Grant camera access and try again, or proceed with World ID alone."
        />
      ) : null}

      {phase === 'no-camera' ? (
        <ReasonPanel
          outcome="No camera found"
          summary="No video input device was detected. Active liveness needs one; a World-only assurance lease (shorter) is still available."
        />
      ) : null}

      {phase === 'model-failed' ? (
        <ReasonPanel outcome="Model failed to load" summary={errorDetail ?? 'The vision model could not be loaded.'} next="Check that /models/hand_landmarker.task and /wasm are served, then retry." />
      ) : null}

      {phase === 'ready' ? (
        <div className="text-center">
          <button
            type="button"
            onClick={() => void beginChallenge()}
            className="border border-hard bg-hard px-6 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase"
          >
            Begin challenge
          </button>
          {errorDetail ? <p className="mt-3 font-tele text-[0.76rem] text-signal">{errorDetail}</p> : null}
        </div>
      ) : null}

      {phase === 'active' && challenge ? (
        <div className="text-center">
          <p className="mb-1 font-shout text-[1.6rem] leading-tight uppercase">
            {subPhase === 'lead-in' ? 'Get ready…' : challenge.instruction}
          </p>
          <div className="mb-3 flex items-center justify-center gap-4 font-tele text-[0.8rem] uppercase">
            <span
              className={
                subPhase === 'holding' ? 'text-acid' : subPhase === 'counting' ? 'text-amber' : 'text-bolt'
              }
            >
              {subPhase === 'searching' ? (
                <span className="flex items-center gap-1.5">
                  <Hand size={14} strokeWidth={1.5} /> Show your hand
                </span>
              ) : (
                `Fingers: ${liveCount} / ${challenge.target}`
              )}
            </span>
            <span className="text-faint">Expires in {secondsLeft ?? '···'}s</span>
          </div>
          <p className="font-tele text-[0.62rem] tracking-[0.1em] text-faint uppercase">{framesCaptured} frames captured</p>
        </div>
      ) : null}

      {phase === 'expired' ? (
        <ReasonPanel outcome="Challenge expired" summary="Expiry is a refusal, not an error — the window to respond closed." next="Retry for a fresh challenge and a fresh nonce." />
      ) : null}

      {phase === 'submitting' ? (
        <p className="text-center font-tele text-[0.8rem] tracking-[0.12em] text-dim uppercase">Submitting…</p>
      ) : null}

      {phase === 'passed' ? (
        <div className="text-center">
          <p className="mb-2 font-shout text-[2.2rem] leading-none text-acid uppercase">Passed</p>
          {result?.reason ? <p className="font-tele text-[0.78rem] text-dim">{result.reason}</p> : null}
        </div>
      ) : null}

      {phase === 'failed' ? (
        <div>
          <ReasonPanel
            outcome="Failed"
            code={result?.failureCode ?? undefined}
            summary={result?.reason ?? errorDetail ?? 'The liveness check did not pass.'}
            next="Retry for a fresh challenge — a challengeId is single-use."
          />
          <div className="mt-4 text-center">
            <button
              type="button"
              onClick={retry}
              className="border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}

      {phase === 'expired' ? (
        <div className="mt-4 text-center">
          <button
            type="button"
            onClick={retry}
            className="border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase"
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  )
}

function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, landmarks: Landmark[], atTarget: boolean) {
  const color = atTarget ? '#4d6300' : '#b06414'
  ctx.strokeStyle = color
  ctx.lineWidth = 1.5
  for (const [a, b] of HAND_CONNECTIONS) {
    const p1 = landmarks[a]!
    const p2 = landmarks[b]!
    ctx.beginPath()
    ctx.moveTo(p1.x * w, p1.y * h)
    ctx.lineTo(p2.x * w, p2.y * h)
    ctx.stroke()
  }
  ctx.fillStyle = color
  const size = 5
  for (const p of landmarks) {
    ctx.fillRect(p.x * w - size / 2, p.y * h - size / 2, size, size)
  }
}
