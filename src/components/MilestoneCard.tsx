import { useState, useEffect } from 'react'
import { Loader2, Clock, AlertTriangle, CheckCircle, XCircle, ExternalLink, Shield } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount } from 'wagmi'
import {
  useSubmitMilestone,
  useApproveAndRelease,
  useRaiseDispute,
  useResolveDispute,
  useClaimAutoRelease,
  useClaimArbiterTimeout,
} from '@/hooks/useEscrow'
import {
  MilestoneStatus, STATUS_LABELS, STATUS_COLORS, STATUS_BG,
  DISPUTE_WINDOW_SECONDS, ARBITER_TIMEOUT_SECONDS,
} from '@/contract'
import { formatUsdc, parseOnchainError } from '@/utils'
import type { MilestoneData } from '@/contract'
import { buildTxExplorerUrl } from '@/onchain-facts'
import { ARC_TESTNET_CHAIN_ID } from '@/contract'

interface Props {
  agreementId: number
  milestone: MilestoneData
  clientAddress: string
  providerAddress: string
  arbiterAddress: string
  onAction: () => void
}

function useNow() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000))
  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 10_000)
    return () => clearInterval(id)
  }, [])
  return now
}

function formatCountdown(secs: number): string {
  if (secs <= 0) return 'Expired'
  const h = Math.floor(secs / 3600)
  const m = Math.floor((secs % 3600) / 60)
  if (h > 0) return `${h}h ${m}m remaining`
  return `${m}m remaining`
}

export default function MilestoneCard({ agreementId, milestone, clientAddress, providerAddress, arbiterAddress, onAction }: Props) {
  const { address } = useAccount()
  const now = useNow()

  const isClient = address?.toLowerCase() === clientAddress.toLowerCase()
  const isProvider = address?.toLowerCase() === providerAddress.toLowerCase()
  const isArbiter = arbiterAddress !== '0x0000000000000000000000000000000000000000'
    && address?.toLowerCase() === arbiterAddress.toLowerCase()
  const hasArbiter = arbiterAddress !== '0x0000000000000000000000000000000000000000'

  const milestoneIdNum = Number(milestone.id)
  const deadlineSecs = Number(milestone.disputeDeadline)
  const submittedAtSecs = Number(milestone.submittedAt)
  const windowSecsLeft = deadlineSecs > 0 ? deadlineSecs - now : 0
  const arbiterDeadline = submittedAtSecs + DISPUTE_WINDOW_SECONDS + ARBITER_TIMEOUT_SECONDS
  const arbiterSecsLeft = arbiterDeadline - now

  const windowOpen = milestone.status === MilestoneStatus.Submitted && windowSecsLeft > 0
  const windowExpired = milestone.status === MilestoneStatus.Submitted && windowSecsLeft <= 0
  const arbiterTimedOut = milestone.status === MilestoneStatus.Disputed && arbiterSecsLeft <= 0

  // Evidence input for provider submit
  const [evidence, setEvidence] = useState('')
  const [showEvidenceInput, setShowEvidenceInput] = useState(false)

  // Arbiter split UI
  const [releasePercent, setReleasePercent] = useState(100)

  const { submit, isPending: subPending, isConfirming: subConfirming, isSuccess: subSuccess, isError: subError, error: subErr, hash: subHash } = useSubmitMilestone()
  const { release, isPending: relPending, isConfirming: relConfirming, isSuccess: relSuccess, isError: relError, error: relErr, hash: relHash } = useApproveAndRelease()
  const { raiseDispute, isPending: dispPending, isConfirming: dispConfirming, isSuccess: dispSuccess, isError: dispError, error: dispErr } = useRaiseDispute()
  const { resolveDispute, isPending: resPending, isConfirming: resConfirming, isSuccess: resSuccess, isError: resError, error: resErr, hash: resHash } = useResolveDispute()
  const { claimAutoRelease, isPending: autoPending, isConfirming: autoConfirming, isSuccess: autoSuccess, isError: autoError, error: autoErr } = useClaimAutoRelease()
  const { claimTimeout, isPending: tooPending, isConfirming: tooConfirming, isSuccess: tooSuccess, isError: tooError, error: tooErr } = useClaimArbiterTimeout()

  useEffect(() => { if (subSuccess) { toast.success('Milestone submitted!'); onAction() } }, [subSuccess, onAction])
  useEffect(() => { if (relSuccess) { toast.success('USDC released to provider!'); onAction() } }, [relSuccess, onAction])
  useEffect(() => { if (dispSuccess) { toast.success('Dispute raised — arbiter notified.'); onAction() } }, [dispSuccess, onAction])
  useEffect(() => { if (resSuccess) { toast.success('Dispute resolved.'); onAction() } }, [resSuccess, onAction])
  useEffect(() => { if (autoSuccess) { toast.success('Auto-released to provider.'); onAction() } }, [autoSuccess, onAction])
  useEffect(() => { if (tooSuccess) { toast.success('Arbiter timeout claimed — USDC refunded.'); onAction() } }, [tooSuccess, onAction])

  useEffect(() => { if (subError && subErr) toast.error(parseOnchainError(subErr)) }, [subError, subErr])
  useEffect(() => { if (relError && relErr) toast.error(parseOnchainError(relErr)) }, [relError, relErr])
  useEffect(() => { if (dispError && dispErr) toast.error(parseOnchainError(dispErr)) }, [dispError, dispErr])
  useEffect(() => { if (resError && resErr) toast.error(parseOnchainError(resErr)) }, [resError, resErr])
  useEffect(() => { if (autoError && autoErr) toast.error(parseOnchainError(autoErr)) }, [autoError, autoErr])
  useEffect(() => { if (tooError && tooErr) toast.error(parseOnchainError(tooErr)) }, [tooError, tooErr])

  const busy = subPending || subConfirming || relPending || relConfirming || dispPending || dispConfirming || resPending || resConfirming || autoPending || autoConfirming || tooPending || tooConfirming

  const releaseAmountRaw = BigInt(Math.floor(Number(milestone.amount) * releasePercent / 100))

  return (
    <div
      className="rounded-2xl p-4"
      style={{ background: 'rgba(255,255,255,0.80)', border: '1px solid var(--border)' }}
    >
      {/* header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="mb-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--subtle)' }}>#{milestoneIdNum + 1}</span>
            <span
              className="rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: STATUS_BG[milestone.status], color: STATUS_COLORS[milestone.status] }}
            >
              {STATUS_LABELS[milestone.status]}
            </span>
            {milestone.status === MilestoneStatus.Disputed && (
              <span className="flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}>
                <AlertTriangle className="size-3" /> In dispute
              </span>
            )}
          </div>
          <p className="text-sm font-medium" style={{ color: 'var(--ink)' }}>{milestone.description}</p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
          {formatUsdc(milestone.amount)} <span className="text-xs font-normal" style={{ color: 'var(--subtle)' }}>USDC</span>
        </span>
      </div>

      {/* evidence submitted */}
      {milestone.evidence && (
        <div className="mt-2 rounded-xl px-3 py-2 text-xs" style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}>
          <span className="font-semibold" style={{ color: 'var(--muted)' }}>Evidence: </span>
          {milestone.evidence.startsWith('http') ? (
            <a href={milestone.evidence} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 underline" style={{ color: 'var(--accent-hover)' }}>
              {milestone.evidence.slice(0, 60)}{milestone.evidence.length > 60 ? '…' : ''}
              <ExternalLink className="size-3" />
            </a>
          ) : milestone.evidence}
        </div>
      )}

      {/* dispute window countdown */}
      {windowOpen && (
        <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: '#92400e' }}>
          <Clock className="size-3" />
          <span>Dispute window: {formatCountdown(windowSecsLeft)}</span>
        </div>
      )}
      {windowExpired && milestone.status === MilestoneStatus.Submitted && (
        <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--success)' }}>
          <CheckCircle className="size-3" />
          <span>Dispute window closed — can approve or auto-release</span>
        </div>
      )}

      {/* arbiter timeout countdown */}
      {milestone.status === MilestoneStatus.Disputed && arbiterSecsLeft > 0 && (
        <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: '#92400e' }}>
          <Shield className="size-3" />
          <span>Arbiter timeout: {formatCountdown(arbiterSecsLeft)}</span>
        </div>
      )}
      {arbiterTimedOut && (
        <div className="mt-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--danger)' }}>
          <XCircle className="size-3" />
          <span>Arbiter did not respond — refund can be claimed</span>
        </div>
      )}

      {/* explorer links for completed actions */}
      {relHash && relSuccess && (
        <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, relHash)} target="_blank" rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-hover)' }}>
          View release tx <ExternalLink className="size-3" />
        </a>
      )}
      {subHash && subSuccess && (
        <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, subHash)} target="_blank" rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-hover)' }}>
          View submit tx <ExternalLink className="size-3" />
        </a>
      )}
      {resHash && resSuccess && (
        <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, resHash)} target="_blank" rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs" style={{ color: 'var(--accent-hover)' }}>
          View resolution tx <ExternalLink className="size-3" />
        </a>
      )}

      {/* ---- PROVIDER ACTIONS ---- */}
      {isProvider && milestone.status === MilestoneStatus.Pending && (
        <div className="mt-3">
          {!showEvidenceInput ? (
            <button
              onClick={() => setShowEvidenceInput(true)}
              className="w-full rounded-xl py-2 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--accent)', color: 'white' }}
            >
              Mark as done
            </button>
          ) : (
            <div className="space-y-2">
              <label className="block text-xs font-semibold" style={{ color: 'var(--muted)' }}>EVIDENCE (note or URL)</label>
              <textarea
                value={evidence}
                onChange={(e) => setEvidence(e.target.value)}
                placeholder="Describe completed work or paste a link..."
                rows={2}
                className="w-full resize-none rounded-xl px-3 py-2 text-sm outline-none"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEvidenceInput(false)}
                  className="flex-1 rounded-xl py-2 text-sm font-medium"
                  style={{ background: 'var(--surface-muted)', color: 'var(--muted)' }}
                >
                  Cancel
                </button>
                <button
                  disabled={!evidence.trim() || busy}
                  onClick={() => submit(agreementId, milestoneIdNum, evidence.trim())}
                  className="flex-1 rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40"
                  style={{ background: 'var(--accent)' }}
                >
                  {subPending || subConfirming ? <span className="flex items-center justify-center gap-1"><Loader2 className="size-3 animate-spin" /> Submitting...</span> : 'Submit'}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ---- CLIENT ACTIONS ---- */}
      {isClient && milestone.status === MilestoneStatus.Submitted && (
        <div className="mt-3 space-y-2">
          {windowOpen ? (
            <>
              <p className="text-xs" style={{ color: 'var(--muted)' }}>
                Approve is available after the 48-hour dispute window closes.
                {hasArbiter ? ' You can raise a dispute now.' : ' No arbiter set — dispute is not available.'}
              </p>
              {hasArbiter && (
                <button
                  disabled={busy}
                  onClick={() => raiseDispute(agreementId, milestoneIdNum)}
                  className="w-full rounded-xl py-2 text-sm font-semibold disabled:opacity-40"
                  style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}
                >
                  {dispPending || dispConfirming ? <span className="flex items-center justify-center gap-1"><Loader2 className="size-3 animate-spin" /> Raising dispute...</span> : 'Raise dispute'}
                </button>
              )}
            </>
          ) : (
            <button
              disabled={busy}
              onClick={() => release(agreementId, milestoneIdNum)}
              className="w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40 transition-all hover:scale-[1.01] active:scale-[0.99]"
              style={{ background: 'var(--success)' }}
            >
              {relPending || relConfirming ? <span className="flex items-center justify-center gap-1"><Loader2 className="size-3 animate-spin" /> Releasing...</span> : `Approve & release ${formatUsdc(milestone.amount)} USDC`}
            </button>
          )}
        </div>
      )}

      {/* auto-release (anyone after window expires and no dispute) */}
      {milestone.status === MilestoneStatus.Submitted && windowExpired && !isClient && (
        <div className="mt-3">
          <button
            disabled={busy}
            onClick={() => claimAutoRelease(agreementId, milestoneIdNum)}
            className="w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            {autoPending || autoConfirming ? <span className="flex items-center justify-center gap-1"><Loader2 className="size-3 animate-spin" /> Processing...</span> : 'Claim auto-release'}
          </button>
        </div>
      )}

      {/* client can also auto-release if they didn't dispute and window is closed */}
      {isClient && milestone.status === MilestoneStatus.Submitted && windowExpired && (
        <div className="mt-2">
          <button
            disabled={busy}
            onClick={() => claimAutoRelease(agreementId, milestoneIdNum)}
            className="w-full rounded-xl py-2 text-sm font-medium disabled:opacity-40"
            style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)' }}
          >
            {autoPending || autoConfirming ? <span className="flex items-center justify-center gap-1"><Loader2 className="size-3 animate-spin" /> Processing...</span> : 'Auto-release (skip approve)'}
          </button>
        </div>
      )}

      {/* ---- ARBITER ACTIONS ---- */}
      {isArbiter && milestone.status === MilestoneStatus.Disputed && (
        <div className="mt-3 space-y-2">
          <label className="block text-xs font-semibold" style={{ color: 'var(--muted)' }}>RELEASE TO PROVIDER</label>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={100}
              value={releasePercent}
              onChange={(e) => setReleasePercent(Number(e.target.value))}
              className="flex-1"
            />
            <span className="w-12 text-right text-sm font-bold tabular-nums" style={{ color: 'var(--ink)' }}>{releasePercent}%</span>
          </div>
          <div className="flex justify-between text-xs tabular-nums" style={{ color: 'var(--muted)' }}>
            <span>Provider: {formatUsdc(releaseAmountRaw)} USDC</span>
            <span>Client: {formatUsdc(milestone.amount - releaseAmountRaw)} USDC</span>
          </div>
          <button
            disabled={busy}
            onClick={() => resolveDispute(agreementId, milestoneIdNum, releaseAmountRaw)}
            className="w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            {resPending || resConfirming ? <span className="flex items-center justify-center gap-1"><Loader2 className="size-3 animate-spin" /> Resolving...</span> : 'Resolve dispute'}
          </button>
        </div>
      )}

      {/* arbiter timeout — anyone can call */}
      {milestone.status === MilestoneStatus.Disputed && arbiterTimedOut && (
        <div className="mt-3">
          <button
            disabled={busy}
            onClick={() => claimTimeout(agreementId, milestoneIdNum)}
            className="w-full rounded-xl py-2 text-sm font-semibold text-white disabled:opacity-40"
            style={{ background: 'var(--danger)' }}
          >
            {tooPending || tooConfirming ? <span className="flex items-center justify-center gap-1"><Loader2 className="size-3 animate-spin" /> Claiming...</span> : 'Claim arbiter timeout (refund to client)'}
          </button>
        </div>
      )}
    </div>
  )
}
