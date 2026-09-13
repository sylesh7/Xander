import { Workflow } from 'lucide-react'
import { EmptyState } from './EmptyState'

/** For console routes named in the spec but not yet built in this pass. */
export function StubPage({ title, stage }: { title: string; stage: string }) {
  return (
    <div className="mx-auto max-w-[720px] py-10">
      <EmptyState
        icon={Workflow}
        title={`${title.toUpperCase()} — NOT BUILT YET`}
        body={`docs/frontendfinal.md §8 places this at ${stage}. The foundation, evidence explorer, actor dossier, and system health screens ship first.`}
      />
    </div>
  )
}
