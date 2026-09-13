'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, ScanFace, Hand, ShieldCheck, ArrowRight, RotateCcw } from 'lucide-react'
import { consoleApi, ApiError } from '@/lib/api/console'
import type {
  ActorView,
  AgentDetail,
  CapabilitiesResponse,
  CreateAgentResponse,
  VerifyAgentResponse,
} from '@/lib/types'
import { ACTION_TYPES, ENS_CHAIN_ID } from '@/lib/types'
import { WorldSelfieCheck } from '@/components/xander/WorldSelfieCheck'
import { LivenessChallenge } from '@/components/xander/LivenessChallenge'
import { ReasonPanel } from '@/components/xander/ReasonPanel'
import { EmptyState } from '@/components/xander/EmptyState'
import { TxLink } from '@/components/xander/Mono'
import { StatusBadge } from '@/components/xander/StatusBadge'

type Step = 1 | 2 | 3 | 4

const STEPS: { n: Step; label: string; icon: typeof Check }[] = [
  { n: 1, label: 'Identity', icon: Check },
  { n: 2, label: 'World ID', icon: ScanFace },
  { n: 3, label: 'Liveness', icon: Hand },
  { n: 4, label: 'Assurance', icon: ShieldCheck },
]

function ProgressRail({ step }: { step: Step }) {
  return (
    <ol className="m-0 mb-8 flex list-none gap-0 p-0 lg:mb-0 lg:w-[180px] lg:flex-col lg:gap-1">
      {STEPS.map((s) => {
        const done = s.n < step
        const active = s.n === step
        return (
          <li
            key={s.n}
            className={`flex flex-1 items-center gap-2 border-b-2 px-2 py-3 font-tele text-[0.72rem] tracking-[0.08em] uppercase lg:flex-none lg:border-b-0 lg:border-l-2 lg:px-3 ${
              active ? 'border-ink text-ink' : done ? 'border-acid text-acid' : 'border-rule text-faint'
            }`}
          >
            {done ? <Check size={14} strokeWidth={2} /> : <s.icon size={14} strokeWidth={1.5} />}
            <span className="hidden sm:inline">
              {s.n}. {s.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

export default function NewAgentWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)

  // Step 1
  const [name, setName] = useState('')
  const [useExisting, setUseExisting] = useState(false)
  const [walletInput, setWalletInput] = useState('')
  const [existingActorId, setExistingActorId] = useState('')
  const [agentUri, setAgentUri] = useState('')
  const [ensLabel, setEnsLabel] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [created, setCreated] = useState<CreateAgentResponse | null>(null)
  const [resolvedWallet, setResolvedWallet] = useState<string | null>(null)

  // Step 2 / 3
  const [worldChallengeId, setWorldChallengeId] = useState<string | null>(null)
  const [livenessChallengeId, setLivenessChallengeId] = useState<string | null>(null)
  const [livenessNote, setLivenessNote] = useState<string | null>(null)

  // Step 4
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifyResult, setVerifyResult] = useState<VerifyAgentResponse | null>(null)
  const [agentDetail, setAgentDetail] = useState<AgentDetail | null>(null)
  const [capabilities, setCapabilities] = useState<CapabilitiesResponse | null>(null)

  async function submitStep1(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    setCreateError(null)
    try {
      const body = useExisting
        ? { actorId: existingActorId.trim(), name: name.trim(), ...(agentUri.trim() ? { agentUri: agentUri.trim() } : {}), ...(ensLabel.trim() ? { ensLabel: ensLabel.trim() } : {}) }
        : { wallet: walletInput.trim(), name: name.trim(), ...(agentUri.trim() ? { agentUri: agentUri.trim() } : {}), ...(ensLabel.trim() ? { ensLabel: ensLabel.trim() } : {}) }

      const { status, data } = await consoleApi.post<CreateAgentResponse & { message?: string }>('/v2/agents', body)
      if (status !== 201) {
        setCreateError(data.message ?? `Could not create the agent (${status}).`)
        return
      }
      setCreated(data)

      let wallet: string | null = walletInput.trim() || null
      if (!wallet) {
        const actorRes = await consoleApi.get<ActorView>(`/v2/actors/${data.actorId}`)
        wallet = actorRes.data.identities.find((i) => i.kind === 'WALLET')?.externalId ?? null
      }
      if (!wallet) {
        setCreateError('This actor has no WALLET identity — World ID needs one to screen against.')
        return
      }
      setResolvedWallet(wallet)
      setStep(2)
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Could not reach the backend.')
    } finally {
      setCreating(false)
    }
  }

  async function runVerify() {
    if (!created || !worldChallengeId) return
    setVerifying(true)
    setVerifyError(null)
    try {
      const { status, data } = await consoleApi.post<VerifyAgentResponse & { message?: string }>(`/v2/agents/${created.agentId}/verify`, {
        worldChallengeId,
        ...(livenessChallengeId ? { livenessChallengeId } : {}),
      })
      if (status !== 200) {
        setVerifyError(data.message ?? `Verification refused (${status}).`)
        return
      }
      setVerifyResult(data)
      const [agentRes, capRes] = await Promise.all([
        consoleApi.get<AgentDetail>(`/v2/agents/${created.agentId}`),
        consoleApi.get<CapabilitiesResponse>(`/v2/actors/${created.actorId}/capabilities`),
      ])
      setAgentDetail(agentRes.data)
      setCapabilities(capRes.data)
    } catch (err) {
      setVerifyError(err instanceof ApiError ? err.message : 'Verification request failed.')
    } finally {
      setVerifying(false)
    }
  }

  function reset() {
    setStep(1)
    setName('')
    setUseExisting(false)
    setWalletInput('')
    setExistingActorId('')
    setAgentUri('')
    setEnsLabel('')
    setCreateError(null)
    setCreated(null)
    setResolvedWallet(null)
    setWorldChallengeId(null)
    setLivenessChallengeId(null)
    setLivenessNote(null)
    setVerifyResult(null)
    setAgentDetail(null)
    setCapabilities(null)
    setVerifyError(null)
  }

  const grantedTypes = new Set((capabilities?.capabilities ?? []).map((c) => c.actionType))

  return (
    <div className="mx-auto max-w-[1000px]">
      <h1 className="mb-1 font-shout text-[2.2rem] leading-none uppercase">Onboard an agent</h1>
      <p className="mb-6 max-w-[64ch] text-[0.86rem] text-dim">The human-backed agent creation flow — identity, World ID, active liveness, then the capability envelope it actually earns.</p>

      <div className="flex flex-col gap-8 lg:flex-row">
        <ProgressRail step={step} />

        <div className="min-w-0 flex-1">
          {step === 1 ? (
            <form onSubmit={submitStep1} className="max-w-[520px]">
              <label className="mb-1 block font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">Name (required)</label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                className="mb-4 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
              />

              <div className="mb-2 flex gap-4 font-tele text-[0.7rem] tracking-[0.08em] text-dim uppercase">
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={!useExisting} onChange={() => setUseExisting(false)} /> New wallet
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" checked={useExisting} onChange={() => setUseExisting(true)} /> Use existing actor
                </label>
              </div>

              {useExisting ? (
                <input
                  value={existingActorId}
                  onChange={(e) => setExistingActorId(e.target.value)}
                  placeholder="actorId"
                  required
                  className="mb-4 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
                />
              ) : (
                <input
                  value={walletInput}
                  onChange={(e) => setWalletInput(e.target.value)}
                  placeholder="0x…"
                  required
                  className="mb-4 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
                />
              )}

              <label className="mb-1 block font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">Agent URI (optional)</label>
              <input
                value={agentUri}
                onChange={(e) => setAgentUri(e.target.value)}
                placeholder="https://…"
                className="mb-4 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
              />

              <label className="mb-1 block font-tele text-[0.66rem] tracking-[0.14em] text-faint uppercase">ENS label (optional)</label>
              <input
                value={ensLabel}
                onChange={(e) => setEnsLabel(e.target.value.toLowerCase())}
                placeholder="alpha"
                pattern="[a-z0-9-]{3,63}"
                className="mb-1 w-full border border-field bg-paper px-3 py-2 font-tele text-[0.85rem] text-ink outline-none focus:border-signal"
              />
              {ensLabel ? <p className="mb-2 font-tele text-[0.78rem] text-ink">{ensLabel}.xander.eth</p> : <div className="mb-2" />}
              <p className="mb-5 font-tele text-[0.7rem] leading-relaxed text-amber uppercase">
                Minting is a real Sepolia transaction and costs gas. Leave blank to create the agent without an on-chain identity.
              </p>

              {createError ? (
                <div className="mb-4">
                  <ReasonPanel outcome="Could not create" summary={createError} />
                </div>
              ) : null}

              <button
                type="submit"
                disabled={creating}
                className="border border-hard bg-hard px-6 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
              >
                {creating ? 'Creating…' : 'Create agent'}
              </button>
            </form>
          ) : null}

          {step === 1 && created ? null : null}

          {step === 2 && created && resolvedWallet ? (
            <div>
              <div className="mb-6 border border-rule p-4">
                <p className="m-0 mb-1 font-tele text-[0.68rem] tracking-[0.1em] text-faint uppercase">Agent created</p>
                <p className="m-0 font-shout text-[1.4rem] uppercase">
                  {created.name} <StatusBadge kind="agentStatus" value={created.status} />
                </p>
                <EmptyState icon={ShieldCheck} title="NO AUTHORITY" body="Zero capabilities. A name is not an authorisation." />
              </div>
              <WorldSelfieCheck
                wallet={resolvedWallet}
                onVerified={(challengeId) => {
                  setWorldChallengeId(challengeId)
                  setStep(3)
                }}
              />
            </div>
          ) : null}

          {step === 3 && created ? (
            <div>
              <LivenessChallenge
                actorId={created.actorId}
                agentId={created.agentId}
                onPassed={(challengeId) => {
                  setLivenessChallengeId(challengeId)
                  setStep(4)
                }}
                onFailed={(reason) => setLivenessNote(reason ?? 'Liveness check failed.')}
              />
              {livenessNote ? <p className="mt-3 text-center font-tele text-[0.74rem] text-signal">{livenessNote}</p> : null}
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={() => setStep(4)}
                  className="border border-field px-5 py-2.5 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-ink uppercase"
                >
                  Skip — World-only assurance (shorter lease)
                </button>
              </div>
            </div>
          ) : null}

          {step === 4 && created && !verifyResult ? (
            <div className="max-w-[480px] text-center">
              <p className="mb-4 text-[0.88rem] text-dim">
                World ID verified{livenessChallengeId ? ' and active liveness passed' : ' — proceeding World-only'}. Ready to establish
                assurance and mint the initial capability envelope.
              </p>
              {verifyError ? (
                <div className="mb-4">
                  <ReasonPanel outcome="Verification refused" summary={verifyError} />
                </div>
              ) : null}
              <button
                type="button"
                onClick={() => void runVerify()}
                disabled={verifying}
                className="border border-hard bg-hard px-6 py-3 font-tele text-[0.78rem] font-bold tracking-[0.16em] text-paper uppercase disabled:opacity-50"
              >
                {verifying ? 'Establishing…' : 'Confirm & activate'}
              </button>
            </div>
          ) : null}

          {step === 4 && verifyResult && created ? (
            <div>
              <div className="mb-6 flex items-center gap-3">
                <span className="font-tele text-[0.9rem] text-faint line-through">DRAFT</span>
                <ArrowRight size={16} strokeWidth={1.5} className="text-faint" />
                <span className="font-shout text-[1.6rem] text-acid uppercase">{verifyResult.status}</span>
              </div>

              <div className="mb-6 grid gap-4 sm:grid-cols-2">
                <div className="border border-rule p-4">
                  <p className="m-0 mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Assurance lease</p>
                  <p className="m-0 mb-1 font-shout text-[1.3rem] uppercase">{verifyResult.assurance.level}</p>
                  <p className="m-0 mb-2 font-tele text-[0.72rem] text-dim">Expires {new Date(verifyResult.assurance.expiresAt).toLocaleString()}</p>
                  <p className="m-0 text-[0.78rem] text-dim">
                    {verifyResult.assurance.level === 'WORLD_PLUS_ACTIVE'
                      ? 'Longer, because a fresh liveness proof says someone is present now, on top of a credential that says someone was verified once.'
                      : 'Shorter — a World credential alone proves someone was verified once, not that they are present now.'}
                  </p>
                </div>

                <div className="border border-rule p-4">
                  <p className="m-0 mb-1 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">ENS identity</p>
                  {created.ens.name ? (
                    <>
                      <p className="m-0 mb-1 font-tele text-[0.9rem] text-ink">{created.ens.name}</p>
                      {agentDetail?.ensTokenId ? <p className="m-0 mb-1 font-tele text-[0.72rem] text-dim">Token {agentDetail.ensTokenId}</p> : null}
                      {verifyResult.ens.txHash ? (
                        <p className="m-0 mb-2"><TxLink hash={verifyResult.ens.txHash} chainId={ENS_CHAIN_ID} /></p>
                      ) : null}
                      <div className="flex flex-wrap gap-1">
                        {(agentDetail?.ens?.onChainActions ?? []).length === 0 ? (
                          <span className="font-tele text-[0.66rem] text-faint uppercase">No EAC roles granted</span>
                        ) : (
                          agentDetail?.ens?.onChainActions.map((a) => (
                            <span key={a} className="border border-rule px-1.5 py-0.5 font-tele text-[0.62rem] text-dim uppercase">
                              {a}
                            </span>
                          ))
                        )}
                      </div>
                    </>
                  ) : (
                    <p className="m-0 font-tele text-[0.78rem] text-faint uppercase">No on-chain identity minted</p>
                  )}
                </div>
              </div>

              <div className="mb-8 border border-rule p-4">
                <p className="m-0 mb-3 font-tele text-[0.62rem] tracking-[0.16em] text-faint uppercase">Capability envelope</p>
                <div className="flex flex-wrap gap-2">
                  {ACTION_TYPES.map((a) => {
                    const granted = grantedTypes.has(a)
                    return (
                      <span
                        key={a}
                        className={`border px-2 py-1 font-tele text-[0.68rem] tracking-[0.06em] uppercase ${
                          granted ? 'border-acid text-acid' : 'border-rule text-faint'
                        }`}
                      >
                        {a} {granted ? '✓' : '✗'}
                      </span>
                    )
                  })}
                </div>
                <p className="mt-3 mb-0 font-tele text-[0.7rem] leading-relaxed text-dim">
                  Nothing that moves value was granted on verification alone.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => router.push(`/console/agents/${created.agentId}`)}
                  className="dn-split flex items-center gap-1.5 border border-hard bg-hard px-5 py-3 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-paper uppercase no-underline"
                >
                  Go to agent
                  <ArrowRight size={14} strokeWidth={1.5} />
                </button>
                <button
                  type="button"
                  onClick={reset}
                  className="flex items-center gap-1.5 border border-field px-5 py-3 font-tele text-[0.74rem] font-bold tracking-[0.16em] text-ink uppercase"
                >
                  <RotateCcw size={14} strokeWidth={1.5} />
                  Create another
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
