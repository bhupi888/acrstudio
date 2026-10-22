import { Loader2, ChevronRight } from 'lucide-react'
import { useAccount } from 'wagmi'
import { useAgreement, useMilestones } from '@/hooks/useEscrow'
import { MilestoneStatus } from '@/contract'
import { formatUsdc, formatAddress } from '@/utils'
import type { AgreementFilter } from './FilterBar'
import ProgressRing from './ProgressRing'

// ---- individual row ----
interface RowMeta {
  id: number
  client: string
  provider: string
  totalAmount: bigint
  funded: boolean
  cancelled: boolean
  releasedCount: number
  totalCount: number
  unreleasedAmount: bigint | undefined
  allReleased: boolean
}

function useRowMeta(id: number): RowMeta | null {
  const { agreementData, milestoneCount, unreleasedAmount } = useAgreement(id)
  const count = milestoneCount != null ? Number(milestoneCount) : 0
  const { milestones } = useMilestones(id, count)

  if (!agreementData) return null

  // v2: getAgreement returns (client, provider, arbiter, totalAmount, fundedAmount, funded, cancelled)
  const [client, provider, , totalAmount, , funded, cancelled] = agreementData
  const releasedCount = milestones.filter(
    (m) => m.status === MilestoneStatus.Released || m.status === MilestoneStatus.AutoReleased
  ).length
  const allReleased = funded && !cancelled && milestones.length > 0 && unreleasedAmount === 0n

  return { id, client, provider, totalAmount, funded, cancelled, releasedCount, totalCount: milestones.length, unreleasedAmount, allReleased }
}

interface AgreementRowProps {
  id: number
  onClick: () => void
}

function AgreementRow({ id, onClick }: AgreementRowProps) {
  const { address } = useAccount()
  const meta = useRowMeta(id)

  if (!meta) {
    return (
      <div className="flex h-16 items-center justify-center rounded-2xl" style={{ background: 'var(--surface-muted)' }}>
        <Loader2 className="size-4 animate-spin" style={{ color: 'var(--subtle)' }} />
      </div>
    )
  }

  const isClient = address?.toLowerCase() === meta.client.toLowerCase()
  const isProvider = address?.toLowerCase() === meta.provider.toLowerCase()

  const progress = meta.funded && meta.totalCount > 0
    ? meta.releasedCount / meta.totalCount
    : 0

  // Role-aware next-step hint
  let hint = ''
  if (!meta.funded && !meta.cancelled) {
    hint = isClient ? 'Fund to activate' : 'Waiting for client to fund'
  } else if (meta.funded && !meta.cancelled && !meta.allReleased) {
    hint = isProvider ? 'Submit completed milestones' : 'Review & approve submissions'
  } else if (meta.allReleased) {
    hint = 'All milestones complete'
  } else if (meta.cancelled) {
    hint = 'Agreement cancelled'
  }

  return (
    <button
      onClick={onClick}
      className="w-full rounded-2xl p-4 text-left transition-all hover:scale-[1.01] active:scale-[0.99]"
      style={{ background: 'rgba(255,255,255,0.80)', border: '1px solid var(--border)', backdropFilter: 'blur(12px)' }}
    >
      <div className="flex items-center gap-3">
        {/* progress ring — only when funded */}
        {meta.funded && meta.totalCount > 0 && (
          <div className="shrink-0">
            <ProgressRing
              progress={progress}
              size={40}
              color={meta.allReleased ? 'var(--success)' : 'var(--accent)'}
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold" style={{ color: 'var(--subtle)' }}>#{id}</span>
            {meta.cancelled ? (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}>Cancelled</span>
            ) : meta.allReleased ? (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(26,128,71,0.14)', color: 'var(--success)' }}>Completed</span>
            ) : meta.funded ? (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(16,97,166,0.10)', color: 'var(--accent-hover)' }}>Active</span>
            ) : (
              <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(146,64,14,0.10)', color: '#92400e' }}>Unfunded</span>
            )}
            {isClient && <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(18,45,69,0.08)', color: 'var(--ink-2)' }}>Client</span>}
            {isProvider && <span className="rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(16,97,166,0.10)', color: 'var(--accent-hover)' }}>Provider</span>}
          </div>
          <div className="flex items-baseline gap-1.5">
            <span className="display font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
              {formatUsdc(meta.totalAmount)}
            </span>
            <span className="text-sm font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
            <span>{isClient ? `Provider: ${formatAddress(meta.provider)}` : `Client: ${formatAddress(meta.client)}`}</span>
            {hint && <span style={{ color: 'var(--accent-hover)' }}>· {hint}</span>}
          </div>
        </div>

        <ChevronRight className="size-4 shrink-0" style={{ color: 'var(--subtle)' }} />
      </div>
    </button>
  )
}

// ---- a filtered row that reads its own meta and may return null ----
interface FilteredRowProps {
  id: number
  filter: AgreementFilter
  search: string
  address: string | undefined
  onClick: () => void
}

function FilteredRow({ id, filter, search, address, onClick }: FilteredRowProps) {
  const meta = useRowMeta(id)

  if (!meta) {
    // still loading — show skeleton only if no filter active (avoid flash)
    if (filter === 'all' && !search) {
      return (
        <div className="flex h-16 items-center justify-center rounded-2xl" style={{ background: 'var(--surface-muted)' }}>
          <Loader2 className="size-4 animate-spin" style={{ color: 'var(--subtle)' }} />
        </div>
      )
    }
    return null
  }

  const isClient = address?.toLowerCase() === meta.client.toLowerCase()
  const isProvider = address?.toLowerCase() === meta.provider.toLowerCase()

  // apply search to address
  const trimmed = search.trim().toLowerCase()
  if (trimmed && !id.toString().includes(trimmed) && !meta.client.toLowerCase().includes(trimmed) && !meta.provider.toLowerCase().includes(trimmed)) {
    return null
  }

  // apply status filter
  if (filter === 'client' && !isClient) return null
  if (filter === 'provider' && !isProvider) return null
  if (filter === 'active' && (!meta.funded || meta.cancelled || meta.allReleased)) return null
  if (filter === 'completed' && !meta.allReleased) return null
  if (filter === 'cancelled' && !meta.cancelled) return null
  if (filter === 'unfunded' && (meta.funded || meta.cancelled)) return null

  return <AgreementRow id={id} onClick={onClick} />
}

// ---- main export ----
interface Props {
  count: number
  onSelect: (id: number) => void
  onNew: () => void
  filter: AgreementFilter
  search: string
}

export default function AgreementList({ count, onSelect, onNew, filter, search }: Props) {
  const { address } = useAccount()

  if (count === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl py-16 text-center" style={{ background: 'rgba(255,255,255,0.60)', border: '1px solid var(--border)' }}>
        <div className="mb-3">
          <div className="flex size-16 items-center justify-center rounded-full mx-auto" style={{ background: 'var(--surface-muted)' }}>
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--subtle)' }}><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M5 4h-.5A2.5 2.5 0 0 0 2 6.5v13A2.5 2.5 0 0 0 4.5 22h15a2.5 2.5 0 0 0 2.5-2.5v-13A2.5 2.5 0 0 0 19.5 4H19"/><path d="M8 10h8M8 14h5"/></svg>
          </div>
        </div>
        <p className="display mb-1 font-semibold" style={{ color: 'var(--ink)' }}>No agreements yet</p>
        <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>Create one to start escrow payments</p>
        <button
          onClick={onNew}
          className="rounded-2xl px-5 py-2.5 text-sm font-semibold text-white"
          style={{ background: 'var(--accent)' }}
        >
          New Agreement
        </button>
      </div>
    )
  }

  const allIds = Array.from({ length: count }, (_, i) => count - i)

  return (
    <div className="space-y-3">
      {allIds.map((id) => (
        <FilteredRow
          key={id}
          id={id}
          filter={filter}
          search={search}
          address={address}
          onClick={() => onSelect(id)}
        />
      ))}
    </div>
  )
}
