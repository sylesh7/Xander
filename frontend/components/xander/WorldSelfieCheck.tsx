'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { ScanFace, X } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type {
  IdKitConfig,
  RpSignatureResponse,
  ScreenClaimResponse,
  WorldChallengeReissueResponse,
  WorldVerifyResponse,
} from '@/lib/types'
import { ReasonPanel } from './ReasonPanel'
import { EmptyState } from './EmptyState'

/**
 * Wizard step 2 — the exact chain proven against a real phone
 * (test_frontend/src/main.ts): POST /screen-claim -> POST /world/rp-signature
 * -> @worldcoin/idkit-core IDKit.requestWithInviteCode().preset(selfieCheckLegacy)
 * -> poll -> POST /world/verify.
 *
 * `idkitResponse` is forwarded to /world/verify byte-for-byte — field
 * remapping is the documented way that call breaks (backend/docs/API-
 * CONTRACT.md). The one field that IS renamed going the other way: the
 * backend's rp-signature returns `sig`, but IDKit's RpContext type calls the
 * same value `signature`.
 */

type Phase = 'screening' | 'no-challenge' | 'idle' | 'requesting' | 'waiting' | 'scanned' | 'verifying' | 'verified' | 'failed'

export function WorldSelfieCheck({
  wallet,
  onVerified,
}: {
  wallet: string
  onVerified: (verificationChallengeId: string) => void
}) {
  const [phase, setPhase] = useState<Phase>('screening')
  const [screenResult, setScreenResult] = useState<ScreenClaimResponse | null>(null)
  const [idkitConfig, setIdkitConfig] = useState<IdKitConfig | null>(null)
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [connectorURI, setConnectorURI] = useState<string | null>(null)
  const [log, setLog] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const cancelledRef = useRef(false)
  const campaignIdRef = useRef(`xander-agent-onboarding-${crypto.randomUUID().slice(0, 8)}`)

  function appendLog(line: string) {
    setLog((l) => [...l, line])
  }

  async function screenWallet() {
    setPhase('screening')
    setError(null)
    try {
      const { data } = await consoleApi.post<ScreenClaimResponse>('/screen-claim', {
        wallet,
        campaignId: campaignIdRef.current,
      })
      setScreenResult(data)
      appendLog(`screen-claim -> ${data.decision}: ${data.reason}`)
      if (data.idkit) {
        setIdkitConfig(data.idkit)
        setPhase('idle')
      } else {
        setPhase('no-challenge')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
      setPhase('no-challenge')
    }
  }

  useEffect(() => {
    void screenWallet()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function reissueChallenge() {
    if (!screenResult) return
    setError(null)
    try {
      const { data } = await consoleApi.post<WorldChallengeReissueResponse>('/world/challenge', { claimId: screenResult.claimId })
      appendLog(`world/challenge (re-issue) -> ${data.reused ? 'reused' : 'fresh'} challenge`)
      if (data.idkit) {
        setIdkitConfig(data.idkit)
        setPhase('idle')
      } else {
        setPhase('no-challenge')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reissue the challenge.')
    }
  }

  async function startSelfieCheck() {
    if (!idkitConfig || !screenResult) return
    cancelledRef.current = false
    setPhase('requesting')
    setError(null)
    setQrDataUrl(null)
    try {
      const { IDKit, selfieCheckLegacy } = await import('@worldcoin/idkit-core')
      const QRCode = (await import('qrcode')).default

      const rpRes = await consoleApi.post<RpSignatureResponse & { message?: string }>('/world/rp-signature', {
        action: idkitConfig.action,
      })
      if (rpRes.status !== 200) throw new Error(rpRes.data.message ?? 'Could not obtain an RP signature.')
      const rp = rpRes.data
      appendLog('world/rp-signature -> real ECDSA signature obtained')

      const request = await IDKit.requestWithInviteCode({
        app_id: idkitConfig.app_id as `app_${string}`,
        action: idkitConfig.action,
        allow_legacy_proofs: idkitConfig.allow_legacy_proofs,
        environment: 'production', // real World App proofs are production-environment — proven against a real phone
        rp_context: {
          rp_id: idkitConfig.rp_id,
          nonce: rp.nonce,
          created_at: rp.created_at,
          expires_at: rp.expires_at,
          signature: rp.sig,
        },
      }).preset(selfieCheckLegacy({ signal: idkitConfig.signal }))

      setConnectorURI(request.connectorURI)
      const dataUrl = await QRCode.toDataURL(request.connectorURI, { width: 260, margin: 1 })
      setQrDataUrl(dataUrl)
      setPhase('waiting')
      appendLog('IDKit request built — waiting for World App')

      let lastType = ''
      while (!cancelledRef.current) {
        const status = await request.pollOnce()
        if (status.type !== lastType) {
          lastType = status.type
          appendLog(`poll -> ${status.type}`)
        }
        if (status.type === 'awaiting_confirmation') setPhase('scanned')
        if (status.type === 'confirmed' && status.result) {
          setPhase('verifying')
          await finishVerify(status.result)
          return
        }
        if (status.type === 'failed') {
          setError(`World App reported: ${status.error}`)
          setPhase('failed')
          return
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
      appendLog('cancelled by user')
      setPhase('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the Selfie Check.')
      setPhase('failed')
    }
  }

  async function finishVerify(idkitResponse: unknown) {
    if (!screenResult) return
    try {
      const { data } = await consoleApi.post<WorldVerifyResponse>('/world/verify', {
        claimId: screenResult.claimId,
        idkitResponse,
        ...(idkitConfig?.rp_id ? { rp_id: idkitConfig.rp_id } : {}),
      })
      appendLog(`world/verify -> ${data.status}: ${data.reason}`)
      if (data.status === 'PASSED') {
        setPhase('verified')
        if (screenResult.verificationChallengeId) onVerified(screenResult.verificationChallengeId)
      } else if (data.status === 'RETRYABLE') {
        setError('World was unreachable — this is not a failed verification. Retry.')
        setPhase('failed')
      } else {
        setError(data.reason)
        setPhase('failed')
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Verification request failed.')
      setPhase('failed')
    }
  }

  function cancel() {
    cancelledRef.current = true
  }

  if (phase === 'screening') {
    return <div className="h-[200px] animate-pulse border border-rule bg-paper-2" />
  }

  if (phase === 'no-challenge') {
    return (
      <div>
        <ReasonPanel
          outcome={screenResult?.decision ?? 'Unavailable'}
          summary={
            error ??
            screenResult?.reason ??
            'This wallet did not land in the CHALLENGE band, so no Selfie Check is being requested — a real, valid World-side/risk-engine answer, not a bug.'
          }
          next="Retry — evidence freshness can change between attempts."
        />
        <button
          type="button"
          onClick={() => void screenWallet()}
          className="mt-4 border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[520px] text-center">
      {phase === 'idle' ? (
        <button
          type="button"
          onClick={() => void startSelfieCheck()}
          className="border border-hard bg-hard px-6 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase"
        >
          Start Selfie Check
        </button>
      ) : null}

      {phase === 'requesting' ? <p className="font-tele text-[0.8rem] text-dim uppercase">Building the signed request…</p> : null}

      {(phase === 'waiting' || phase === 'scanned') && qrDataUrl ? (
        <div>
          <div className={`mx-auto mb-4 inline-block border-[3px] p-4 ${phase === 'scanned' ? 'border-amber' : 'border-hard'}`}>
            <Image src={qrDataUrl} alt="Scan with World App" width={260} height={260} unoptimized />
          </div>
          <p className="mb-1 flex items-center justify-center gap-2 font-shout text-[1.4rem] uppercase">
            <ScanFace size={20} strokeWidth={1.5} />
            Scan with World App
          </p>
          <p className={`mb-4 font-tele text-[0.78rem] uppercase ${phase === 'scanned' ? 'text-amber' : 'animate-pulse text-bolt'}`}>
            {phase === 'scanned' ? 'Scanned — confirm on your phone' : 'Waiting for connection'}
          </p>
          {connectorURI ? (
            <p className="mb-4 break-all font-tele text-[0.66rem] text-faint">
              <a href={connectorURI} target="_blank" rel="noopener" className="dn-split text-ink">
                {connectorURI}
              </a>
            </p>
          ) : null}
          <button
            type="button"
            onClick={cancel}
            className="flex items-center gap-1.5 border border-field px-4 py-2 font-tele text-[0.7rem] font-bold tracking-[0.12em] text-ink uppercase"
          >
            <X size={13} strokeWidth={1.5} />
            Cancel
          </button>
        </div>
      ) : null}

      {phase === 'verifying' ? <p className="font-tele text-[0.8rem] text-dim uppercase">Verifying with World…</p> : null}

      {phase === 'verified' ? (
        <div>
          <p className="mb-2 font-shout text-[2.2rem] leading-none text-acid uppercase">✓ Verified</p>
          <p className="font-tele text-[0.78rem] text-dim">Real World ID Selfie Check, passed.</p>
        </div>
      ) : null}

      {phase === 'failed' ? (
        <div>
          <ReasonPanel outcome="Selfie Check failed" summary={error ?? 'The check did not complete.'} next="Reissue a fresh challenge and retry." />
          <button
            type="button"
            onClick={() => void reissueChallenge()}
            className="mt-4 border border-hard bg-hard px-5 py-2.5 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase"
          >
            Retry
          </button>
        </div>
      ) : null}

      {log.length > 0 ? (
        <div className="mt-6 border-t border-rule pt-3 text-left">
          <ul className="m-0 list-none space-y-1 p-0 font-tele text-[0.68rem] text-faint">
            {log.map((l, i) => (
              <li key={i}>&gt; {l}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {phase === 'idle' && !qrDataUrl && log.length === 0 ? (
        <EmptyState icon={ScanFace} title="READY" body="Click Start Selfie Check to build the real signed request." />
      ) : null}
    </div>
  )
}
