import { useCallback } from 'react'
import { toast } from 'sonner'
import { MilestoneStatus, STATUS_LABELS } from '@/contract'
import { formatUsdc, formatAddress } from '@/utils'
import type { AgreementData } from '@/contract'

function statusIcon(s: MilestoneStatus): string {
  switch (s) {
    case MilestoneStatus.Released:
    case MilestoneStatus.AutoReleased: return '[✓]'
    case MilestoneStatus.Disputed: return '[!]'
    case MilestoneStatus.Cancelled: return '[x]'
    default: return '[ ]'
  }
}

/**
 * Returns a function that copies a plain-text summary of an agreement to
 * the clipboard. Suitable for pasting into email, Notion, or a contract.
 */
export function useExportAgreement(agreement: AgreementData | null, unreleasedAmount: bigint | undefined) {
  return useCallback(() => {
    if (!agreement) return

    const hasArbiter = agreement.arbiter !== '0x0000000000000000000000000000000000000000'
    const releasedAmount = agreement.milestones
      .filter((m) => m.status === MilestoneStatus.Released || m.status === MilestoneStatus.AutoReleased)
      .reduce((s, m) => s + m.amount, 0n)

    const lines: string[] = [
      '═══════════════════════════════════════',
      `  MILESTONE ESCROW — AGREEMENT #${agreement.id}`,
      '═══════════════════════════════════════',
      '',
      `Status:    ${agreement.cancelled ? 'Cancelled' : agreement.funded && unreleasedAmount === 0n && agreement.milestones.length > 0 ? 'Completed' : agreement.funded ? 'Active' : 'Awaiting funds'}`,
      `Total:     ${formatUsdc(agreement.totalAmount)} USDC`,
      `Released:  ${formatUsdc(releasedAmount)} USDC`,
      `In escrow: ${formatUsdc(unreleasedAmount ?? 0n)} USDC`,
      '',
      `Client:    ${agreement.client}`,
      `Provider:  ${agreement.provider}`,
      hasArbiter ? `Arbiter:   ${agreement.arbiter}` : `Arbiter:   none`,
      '',
      '───────────────────────────────────────',
      '  MILESTONES',
      '───────────────────────────────────────',
      '',
      ...agreement.milestones.map((m, i) => {
        const lines = [
          `${statusIcon(m.status)} ${i + 1}. ${m.description}`,
          `      ${formatUsdc(m.amount)} USDC  ·  ${STATUS_LABELS[m.status]}`,
        ]
        if (m.evidence) lines.push(`      Evidence: ${m.evidence}`)
        return lines.join('\n')
      }),
      '',
      '───────────────────────────────────────',
      `Generated: ${new Date().toUTCString()}`,
      `Contract:  ${formatAddress('0xdc2a32b1ac670fae6328078ec936f99625b5349f')}`,
      `Chain:     Arc Testnet (5042002)`,
      '═══════════════════════════════════════',
    ]

    const text = lines.join('\n')
    void navigator.clipboard.writeText(text).then(() =>
      toast.success('Agreement summary copied to clipboard')
    )
  }, [agreement, unreleasedAmount])
}
