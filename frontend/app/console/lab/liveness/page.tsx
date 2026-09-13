'use client'

import { useState } from 'react'
import { LivenessChallenge } from '@/components/xander/LivenessChallenge'

/**
 * Stage 4's standalone test harness (frontend spec §8: "build it standalone
 * against a hardcoded actor id before wiring it into the wizard"). Not part
 * of the information architecture in §2 — Stage 5 folds this component into
 * `/console/agents/new` step 3 and this route can go away then.
 */
export default function LivenessLabPage() {
  const [actorId, setActorId] = useState('cmtza8m4b0002iqtc5hxnbtvh')
  const [started, setStarted] = useState(false)
  const [log, setLog] = useState<string[]>([])

  return (
    <div className="mx-auto max-w-[720px]">
      <h1 className="mb-1 font-shout text-[2rem] leading-none uppercase">Liveness lab</h1>
      <p className="mb-6 max-w-[60ch] text-[0.86rem] text-dim">
        Stage 4 standalone test harness for the MediaPipe active-liveness component — isolated from the onboarding
        wizard on purpose, per the build order.
      </p>

      {!started ? (
        <div className="mb-6 flex gap-2">
          <input
            value={actorId}
            onChange={(e) => setActorId(e.target.value)}
            placeholder="actorId"
            className="flex-1 border border-field bg-paper px-3 py-2 font-tele text-[0.82rem] text-ink outline-none focus:border-signal"
          />
          <button
            type="button"
            onClick={() => setStarted(true)}
            disabled={!actorId.trim()}
            className="border border-hard bg-hard px-4 py-2 font-tele text-[0.72rem] font-bold tracking-[0.14em] text-paper uppercase disabled:opacity-40"
          >
            Load component
          </button>
        </div>
      ) : (
        <p className="mb-6 font-tele text-[0.7rem] tracking-[0.1em] text-faint uppercase">Actor: {actorId}</p>
      )}

      {started ? (
        <LivenessChallenge
          actorId={actorId}
          onPassed={(challengeId) => setLog((l) => [`PASSED · challengeId=${challengeId}`, ...l])}
          onFailed={(reason, code) => setLog((l) => [`FAILED · ${code ?? 'no code'} · ${reason ?? 'no reason'}`, ...l])}
        />
      ) : null}

      {log.length > 0 ? (
        <div className="mt-8 border-t border-rule pt-4">
          <h2 className="mb-2 font-tele text-[0.66rem] font-bold tracking-[0.16em] text-faint uppercase">Result log</h2>
          <ul className="m-0 list-none space-y-1 p-0 font-tele text-[0.76rem] text-dim">
            {log.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}
