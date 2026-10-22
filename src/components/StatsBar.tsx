import { motion } from 'framer-motion'
import { Loader2 } from 'lucide-react'
import { useGlobalStats } from '@/hooks/useGlobalStats'
import { formatUsdc } from '@/utils'

interface Props {
  agreementCount: number
}

interface StatPillProps {
  label: string
  value: string | undefined
  color: string
  loading: boolean
}

function StatPill({ label, value, color, loading }: StatPillProps) {
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center rounded-2xl px-3 py-3 text-center"
      style={{ background: 'rgba(255,255,255,0.72)', border: '1px solid var(--border)' }}
    >
      <span className="mb-0.5 text-[10px] font-semibold uppercase tracking-widest" style={{ color: 'var(--subtle)', letterSpacing: '0.08em' }}>
        {label}
      </span>
      {loading ? (
        <Loader2 className="size-3.5 animate-spin" style={{ color: 'var(--subtle)' }} />
      ) : (
        <motion.span
          key={value}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="display text-base font-bold tabular-nums"
          style={{ color }}
        >
          {value ?? '—'}
        </motion.span>
      )}
    </div>
  )
}

export default function StatsBar({ agreementCount }: Props) {
  const { totalLocked, totalReleased, isLoading } = useGlobalStats(agreementCount)

  return (
    <div className="mb-4 flex gap-2">
      <StatPill
        label="In escrow"
        value={totalLocked !== undefined ? `${formatUsdc(totalLocked)} USDC` : undefined}
        color="var(--accent-hover)"
        loading={isLoading && totalLocked === undefined}
      />
      <StatPill
        label="Released"
        value={totalReleased !== undefined ? `${formatUsdc(totalReleased)} USDC` : undefined}
        color="var(--success)"
        loading={isLoading && totalReleased === undefined}
      />
      <StatPill
        label="Agreements"
        value={agreementCount.toString()}
        color="var(--ink)"
        loading={false}
      />
    </div>
  )
}
