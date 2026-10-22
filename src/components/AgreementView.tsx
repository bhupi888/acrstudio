import { useEffect, useState } from 'react'
import { Loader2, ExternalLink, DollarSign, ShieldX, Shield, Share2, Activity, ListChecks, Copy } from 'lucide-react'
import { toast } from 'sonner'
import { useAccount, useSwitchChain } from 'wagmi'
import { useAgreementFull, useApproveUsdc, useFundEscrow, useCancelRefund, useUsdcAllowance } from '@/hooks/useEscrow'
import { ARC_TESTNET_CHAIN_ID, MilestoneStatus } from '@/contract'
import { formatUsdc, formatAddress, parseOnchainError } from '@/utils'
import MilestoneCard from './MilestoneCard'
import ActivityFeed from './ActivityFeed'
import { buildTxExplorerUrl, buildAddressExplorerUrl } from '@/onchain-facts'
import { useExportAgreement } from '@/hooks/useExportAgreement'

interface Props {
  agreementId: number
  onBack: () => void
}

export default function AgreementView({ agreementId, onBack }: Props) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const wrongChain = chainId !== ARC_TESTNET_CHAIN_ID

  const { agreement, unreleasedAmount, isLoading, refetch } = useAgreementFull(agreementId)
  const { allowance, refetch: refetchAllowance } = useUsdcAllowance(address)

  const { approve, isPending: approvePending, isConfirming: approveConfirming, isSuccess: approveSuccess, isError: approveError, error: approveErr } = useApproveUsdc()
  const { fund, isPending: fundPending, isConfirming: fundConfirming, isSuccess: fundSuccess, isError: fundError, error: fundErr, hash: fundHash } = useFundEscrow()
  const { cancel, isPending: cancelPending, isConfirming: cancelConfirming, isSuccess: cancelSuccess, isError: cancelError, error: cancelErr } = useCancelRefund()

  const [step, setStep] = useState<'idle' | 'approving' | 'funding'>('idle')
  const [tab, setTab] = useState<'milestones' | 'activity'>('milestones')

  const exportSummary = useExportAgreement(agreement, unreleasedAmount)

  useEffect(() => {
    if (approveSuccess) {
      toast.success('USDC approved. Now fund the escrow.')
      setStep('funding')
      void refetchAllowance()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [approveSuccess])

  useEffect(() => {
    if (fundSuccess) {
      toast.success('Escrow funded! Share the agreement ID with the provider.')
      setStep('idle')
      void refetch()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fundSuccess])

  useEffect(() => {
    if (cancelSuccess) {
      toast.success('Agreement cancelled. Unreleased USDC refunded.')
      void refetch()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cancelSuccess])

  useEffect(() => { if (approveError && approveErr) toast.error(parseOnchainError(approveErr)) }, [approveError, approveErr])
  useEffect(() => { if (fundError && fundErr) toast.error(parseOnchainError(fundErr)) }, [fundError, fundErr])
  useEffect(() => { if (cancelError && cancelErr) toast.error(parseOnchainError(cancelErr)) }, [cancelError, cancelErr])

  if (isLoading || !agreement) {
    return (
      <div className="flex min-h-[200px] items-center justify-center">
        <Loader2 className="size-6 animate-spin" style={{ color: 'var(--subtle)' }} />
      </div>
    )
  }

  const isClient = address?.toLowerCase() === agreement.client.toLowerCase()
  const isProvider = address?.toLowerCase() === agreement.provider.toLowerCase()
  const hasArbiter = agreement.arbiter !== '0x0000000000000000000000000000000000000000'

  const needsApproval = isClient && !agreement.funded && !agreement.cancelled
    && allowance !== undefined && allowance < agreement.totalAmount
  const canFund = isClient && !agreement.funded && !agreement.cancelled
    && allowance !== undefined && allowance >= agreement.totalAmount
  const canCancel = isClient && agreement.funded && !agreement.cancelled

  const releasedAmount = agreement.milestones
    .filter((m) => m.status === MilestoneStatus.Released || m.status === MilestoneStatus.AutoReleased)
    .reduce((s, m) => s + m.amount, 0n)

  const handleFundFlow = () => {
    if (wrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    if (needsApproval) { setStep('approving'); approve(agreement.totalAmount) }
    else if (canFund) { setStep('funding'); fund(agreementId) }
  }

  const handleCancel = () => {
    if (wrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    if (window.confirm(`Cancel agreement and refund ${formatUsdc(unreleasedAmount ?? 0n)} USDC to yourself?`)) {
      cancel(agreementId)
    }
  }

  const fundBusy = approvePending || approveConfirming || fundPending || fundConfirming
  const cancelBusy = cancelPending || cancelConfirming

  let fundLabel: React.ReactNode = 'Fund Escrow'
  if (step === 'approving' && (approvePending || approveConfirming)) {
    fundLabel = <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{approveConfirming ? 'Approving USDC…' : 'Confirm in wallet…'}</span>
  } else if (step === 'funding' && (fundPending || fundConfirming)) {
    fundLabel = <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" />{fundConfirming ? 'Funding escrow…' : 'Confirm in wallet…'}</span>
  } else if (needsApproval) {
    fundLabel = 'Approve USDC, then Fund'
  }

  const allDone = agreement.funded && !agreement.cancelled && unreleasedAmount === 0n && agreement.milestones.length > 0

  return (
    <div>
      <button onClick={onBack} className="mb-4 text-xs font-semibold transition-colors hover:opacity-70" style={{ color: 'var(--accent-hover)' }}>
        ← All agreements
      </button>

      {/* Header card */}
      <div className="mb-4 rounded-3xl p-5" style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(20px)', border: '1px solid var(--border)' }}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <span className="text-xs font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>Agreement #{agreementId}</span>
            <h2 className="display mt-0.5 text-2xl font-bold" style={{ color: 'var(--ink)' }}>
              {formatUsdc(agreement.totalAmount)}{' '}
              <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
            </h2>
          </div>
          <div className="text-right">
            {agreement.cancelled ? (
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(186,43,76,0.10)', color: 'var(--danger)' }}>Cancelled</span>
            ) : allDone ? (
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(26,128,71,0.14)', color: 'var(--success)' }}>Completed</span>
            ) : agreement.funded ? (
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(16,97,166,0.10)', color: 'var(--accent-hover)' }}>Active</span>
            ) : (
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={{ background: 'rgba(146,64,14,0.10)', color: '#92400e' }}>Awaiting funds</span>
            )}
          </div>
        </div>

        {/* Party info */}
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
            <div className="mb-0.5 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>Client {isClient && '(you)'}</div>
            <a href={buildAddressExplorerUrl(ARC_TESTNET_CHAIN_ID, agreement.client)} target="_blank" rel="noreferrer"
              className="mono flex items-center gap-1 text-xs" style={{ color: 'var(--ink-2)' }}>
              {formatAddress(agreement.client)} <ExternalLink className="size-3 shrink-0" />
            </a>
          </div>
          <div className="rounded-xl p-3" style={{ background: 'var(--surface-muted)' }}>
            <div className="mb-0.5 text-xs font-semibold" style={{ color: 'var(--subtle)' }}>Provider {isProvider && '(you)'}</div>
            <a href={buildAddressExplorerUrl(ARC_TESTNET_CHAIN_ID, agreement.provider)} target="_blank" rel="noreferrer"
              className="mono flex items-center gap-1 text-xs" style={{ color: 'var(--ink-2)' }}>
              {formatAddress(agreement.provider)} <ExternalLink className="size-3 shrink-0" />
            </a>
          </div>
        </div>

        {/* Arbiter info */}
        {hasArbiter && (
          <div className="mb-3 rounded-xl p-3 flex items-center gap-2" style={{ background: 'rgba(16,97,166,0.06)', border: '1px solid rgba(16,97,166,0.12)' }}>
            <Shield className="size-4 shrink-0" style={{ color: 'var(--accent-hover)' }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-semibold" style={{ color: 'var(--accent-hover)' }}>Arbiter set</div>
              <a href={buildAddressExplorerUrl(ARC_TESTNET_CHAIN_ID, agreement.arbiter)} target="_blank" rel="noreferrer"
                className="mono flex items-center gap-1 text-xs" style={{ color: 'var(--ink-2)' }}>
                {formatAddress(agreement.arbiter)} <ExternalLink className="size-3 shrink-0" />
              </a>
            </div>
            <span className="text-xs" style={{ color: 'var(--subtle)' }}>48h dispute window</span>
          </div>
        )}

        {/* Progress bar */}
        {agreement.funded && (
          <div>
            <div className="mb-1 flex items-center justify-between text-xs" style={{ color: 'var(--subtle)' }}>
              <span>Released: {formatUsdc(releasedAmount)} USDC</span>
              <span>In escrow: {formatUsdc(unreleasedAmount ?? 0n)} USDC</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: agreement.totalAmount > 0n ? `${Number((releasedAmount * 100n) / agreement.totalAmount)}%` : '0%',
                  background: 'var(--success)',
                }}
              />
            </div>
          </div>
        )}

        {/* Fund button */}
        {isClient && !agreement.funded && !agreement.cancelled && (
          <button
            disabled={fundBusy}
            onClick={handleFundFlow}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'var(--accent)' }}
          >
            {!fundBusy && <DollarSign className="size-4" />}
            {fundLabel}
          </button>
        )}

        {/* Cancel button */}
        {canCancel && (
          <button
            disabled={cancelBusy}
            onClick={handleCancel}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-2xl py-2.5 text-sm font-semibold transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            style={{ background: 'rgba(186,43,76,0.08)', color: 'var(--danger)' }}
          >
            {cancelBusy ? <Loader2 className="size-4 animate-spin" /> : <ShieldX className="size-4" />}
            {cancelBusy ? (cancelConfirming ? 'Cancelling…' : 'Confirm in wallet…') : `Cancel & Refund ${formatUsdc(unreleasedAmount ?? 0n)} USDC`}
          </button>
        )}

        {fundSuccess && fundHash && (
          <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, fundHash)} target="_blank" rel="noreferrer"
            className="mt-2 flex items-center justify-center gap-1 text-xs" style={{ color: 'var(--success)' }}>
            View funding transaction <ExternalLink className="size-3" />
          </a>
        )}
      </div>

      {/* Share + tab row */}
      <div className="mb-3 flex items-center justify-between">
        {/* tabs */}
        <div className="flex gap-1 rounded-xl p-1" style={{ background: 'rgba(255,255,255,0.60)', border: '1px solid var(--border)' }}>
          <button
            onClick={() => setTab('milestones')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
            style={tab === 'milestones'
              ? { background: 'white', color: 'var(--ink)', boxShadow: '0 1px 4px rgba(18,45,69,0.08)' }
              : { color: 'var(--muted)' }}
          >
            <ListChecks className="size-3.5" />
            Milestones ({agreement.milestones.length})
          </button>
          <button
            onClick={() => setTab('activity')}
            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all"
            style={tab === 'activity'
              ? { background: 'white', color: 'var(--ink)', boxShadow: '0 1px 4px rgba(18,45,69,0.08)' }
              : { color: 'var(--muted)' }}
          >
            <Activity className="size-3.5" />
            Activity
          </button>
        </div>

        {/* share + export */}
        <div className="flex gap-1.5">
          <button
            onClick={exportSummary}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
            title="Copy plain-text summary"
          >
            <Copy className="size-3.5" />
            Export
          </button>
          <button
            onClick={() => {
              const url = `${window.location.origin}${window.location.pathname}?agreement=${agreementId}`
              void navigator.clipboard.writeText(url).then(() => toast.success('Link copied!'))
            }}
            className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-all hover:opacity-80"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)', color: 'var(--ink-2)' }}
          >
            <Share2 className="size-3.5" />
            Share
          </button>
        </div>
      </div>

      {tab === 'milestones' && (
        <div className="space-y-3">
          {agreement.milestones.map((m) => (
            <MilestoneCard
              key={Number(m.id)}
              agreementId={agreementId}
              milestone={m}
              clientAddress={agreement.client}
              providerAddress={agreement.provider}
              arbiterAddress={agreement.arbiter}
              onAction={refetch}
            />
          ))}
        </div>
      )}

      {tab === 'activity' && (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.80)', border: '1px solid var(--border)' }}>
          <ActivityFeed agreementId={agreementId} />
        </div>
      )}
    </div>
  )
}
