import { Loader2, ExternalLink } from 'lucide-react'
import { useAgreementEvents } from '@/hooks/useAgreementEvents'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { ARC_TESTNET_CHAIN_ID } from '@/contract'

// Map event type to a colour dot
const EVENT_COLORS: Record<string, string> = {
  EscrowFunded: 'var(--accent)',
  MilestoneSubmitted: '#92400e',
  MilestoneReleased: 'var(--success)',
  EscrowCancelled: 'var(--danger)',
  MilestoneDisputeRaised: 'var(--danger)',
  MilestoneArbiterDecision: 'var(--accent-hover)',
  MilestoneAutoReleased: 'var(--success)',
  ArbiterTimeoutClaimed: 'var(--danger)',
}

interface Props {
  agreementId: number
}

export default function ActivityFeed({ agreementId }: Props) {
  const { events, isLoading } = useAgreementEvents(agreementId)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <Loader2 className="size-5 animate-spin" style={{ color: 'var(--subtle)' }} />
      </div>
    )
  }

  if (events.length === 0) {
    return (
      <p className="py-4 text-center text-xs" style={{ color: 'var(--subtle)' }}>
        No on-chain activity yet.
      </p>
    )
  }

  return (
    <div className="relative pl-5">
      {/* vertical line */}
      <div className="absolute left-[7px] top-2 bottom-2 w-px" style={{ background: 'var(--border)' }} />

      <div className="space-y-4">
        {events.map((ev, i) => (
          <div key={i} className="relative flex items-start gap-3">
            {/* dot */}
            <span
              className="absolute -left-5 mt-[3px] flex size-3.5 shrink-0 items-center justify-center rounded-full ring-2 ring-white"
              style={{ background: EVENT_COLORS[ev.type] ?? 'var(--subtle)' }}
            />

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{ev.label}</span>
                <a
                  href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, ev.txHash)}
                  target="_blank"
                  rel="noreferrer"
                  className="shrink-0 flex items-center gap-0.5 text-xs"
                  style={{ color: 'var(--subtle)' }}
                >
                  <span className="mono">{ev.txHash.slice(0, 8)}…</span>
                  <ExternalLink className="size-2.5" />
                </a>
              </div>
              {ev.detail && (
                <p className="text-xs" style={{ color: 'var(--muted)' }}>{ev.detail}</p>
              )}
              <p className="text-xs tabular-nums" style={{ color: 'var(--subtle)' }}>
                Block {ev.blockNumber.toString()}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
