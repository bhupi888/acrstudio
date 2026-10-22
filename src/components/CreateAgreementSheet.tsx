import { useState, useEffect } from 'react'
import { X, Plus, Trash2, Loader2, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { toast } from 'sonner'
import { useAccount, useSwitchChain } from 'wagmi'
import { useCreateAgreement } from '@/hooks/useEscrow'
import { ARC_TESTNET_CHAIN_ID, INDUSTRY_TEMPLATES, type IndustryTemplate } from '@/contract'
import { parseOnchainError } from '@/utils'
import { parseUsdc } from '@/onchain-money'

interface MilestoneRow { description: string; amount: string }

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (id: number) => void
}

const springs = {
  sheet: { type: 'spring' as const, damping: 32, stiffness: 380, mass: 0.9 },
}

export default function CreateAgreementSheet({ open, onClose, onCreated }: Props) {
  const { address, chainId } = useAccount()
  const { switchChain } = useSwitchChain()
  const { create, isPending, isConfirming, isSuccess, isError, error } = useCreateAgreement()

  const [provider, setProvider] = useState('')
  const [arbiter, setArbiter] = useState('')
  const [milestones, setMilestones] = useState<MilestoneRow[]>([
    { description: '', amount: '' },
    { description: '', amount: '' },
  ])
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')

  const wrongChain = chainId !== ARC_TESTNET_CHAIN_ID

  useEffect(() => {
    if (isSuccess) {
      toast.success('Agreement created! Fund it to activate.')
      onCreated(0)
      onClose()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess])

  useEffect(() => {
    if (isError && error) toast.error(parseOnchainError(error))
  }, [isError, error])

  const applyTemplate = (tpl: IndustryTemplate) => {
    setMilestones(tpl.milestones.map((m) => ({ description: m.description, amount: m.amount })))
    setSelectedTemplate(tpl.id)
  }

  const addMilestone = () => {
    if (milestones.length >= 20) return
    setMilestones((prev) => [...prev, { description: '', amount: '' }])
  }

  const removeMilestone = (i: number) => {
    if (milestones.length <= 1) return
    setMilestones((prev) => prev.filter((_, idx) => idx !== i))
  }

  const updateMilestone = (i: number, field: 'description' | 'amount', value: string) => {
    setMilestones((prev) => prev.map((m, idx) => idx === i ? { ...m, [field]: value } : m))
  }

  const total = milestones.reduce((s, m) => {
    const n = parseFloat(m.amount)
    return s + (isNaN(n) ? 0 : n)
  }, 0)

  const handleSubmit = () => {
    if (!address) return
    if (wrongChain) { switchChain({ chainId: ARC_TESTNET_CHAIN_ID }); return }
    if (!provider.trim()) { toast.error('Provider address is required'); return }
    for (const m of milestones) {
      if (!m.description.trim()) { toast.error('All milestone descriptions are required'); return }
      const n = parseFloat(m.amount)
      if (isNaN(n) || n <= 0) { toast.error('All milestone amounts must be greater than 0'); return }
    }
    const arbiterAddr = arbiter.trim() || '0x0000000000000000000000000000000000000000'
    const descriptions = milestones.map((m) => m.description.trim())
    const amounts = milestones.map((m) => parseUsdc(m.amount))
    create(provider.trim(), arbiterAddr, descriptions, amounts)
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" />
          <motion.section
            className="relative w-full max-w-lg overflow-hidden rounded-t-3xl"
            style={{ background: 'rgba(255,255,255,0.96)', backdropFilter: 'blur(40px) saturate(200%)' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={springs.sheet}
            onClick={(e) => e.stopPropagation()}
          >
            {/* spectral strip */}
            <div className="h-1" style={{ background: 'linear-gradient(90deg,#6c8ef5,#a78bfa,#f472b6,#fb923c)' }} />
            {/* drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-black/10" />
            </div>

            <div className="max-h-[82dvh] overflow-y-auto px-5 pb-8 pt-2">
              {/* header */}
              <div className="mb-4 flex items-center justify-between">
                <h2 className="display text-lg font-bold" style={{ color: 'var(--ink)' }}>New Agreement</h2>
                <button onClick={onClose} className="flex size-8 items-center justify-center rounded-full" style={{ background: 'var(--surface-muted)' }}>
                  <X className="size-4" style={{ color: 'var(--muted)' }} />
                </button>
              </div>

              {/* industry template picker */}
              <div className="mb-5">
                <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>QUICK START TEMPLATE</label>
                <div className="relative">
                  <select
                    value={selectedTemplate}
                    onChange={(e) => {
                      const tpl = INDUSTRY_TEMPLATES.find((t) => t.id === e.target.value)
                      if (tpl) applyTemplate(tpl)
                      else setSelectedTemplate('')
                    }}
                    className="w-full appearance-none rounded-xl px-4 py-2.5 pr-10 text-sm font-medium outline-none"
                    style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                  >
                    <option value="">Select a template (optional)</option>
                    {INDUSTRY_TEMPLATES.map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                  <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2" style={{ color: 'var(--subtle)' }} />
                </div>
              </div>

              {/* provider */}
              <div className="mb-4">
                <label className="mb-1.5 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>PROVIDER ADDRESS</label>
                <input
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  placeholder="0x..."
                  className="mono w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                />
              </div>

              {/* arbiter (optional) */}
              <div className="mb-5">
                <label className="mb-1 block text-xs font-semibold" style={{ color: 'var(--muted)' }}>ARBITER ADDRESS <span style={{ color: 'var(--subtle)' }}>(optional)</span></label>
                <p className="mb-1.5 text-xs" style={{ color: 'var(--subtle)' }}>
                  If set, this address can resolve disputes raised within 48 h of milestone submission.
                </p>
                <input
                  value={arbiter}
                  onChange={(e) => setArbiter(e.target.value)}
                  placeholder="0x... (leave blank for no arbiter)"
                  className="mono w-full rounded-xl px-4 py-2.5 text-sm outline-none"
                  style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                />
              </div>

              {/* milestones */}
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>MILESTONES ({milestones.length}/20)</label>
                <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--accent-hover)' }}>
                  Total: {total.toFixed(2)} USDC
                </span>
              </div>

              <div className="mb-4 space-y-2">
                {milestones.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="w-5 shrink-0 text-center text-xs font-semibold tabular-nums" style={{ color: 'var(--subtle)' }}>{i + 1}</span>
                    <input
                      value={m.description}
                      onChange={(e) => updateMilestone(i, 'description', e.target.value)}
                      placeholder="Describe this milestone"
                      className="flex-1 rounded-xl px-3 py-2 text-sm outline-none"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                    />
                    <input
                      value={m.amount}
                      onChange={(e) => updateMilestone(i, 'amount', e.target.value.replace(/[^0-9.]/g, ''))}
                      placeholder="USDC"
                      inputMode="decimal"
                      className="w-20 rounded-xl px-3 py-2 text-right text-sm tabular-nums outline-none"
                      style={{ background: 'var(--surface-muted)', color: 'var(--ink)', border: '1px solid var(--border)' }}
                    />
                    <button
                      onClick={() => removeMilestone(i)}
                      disabled={milestones.length <= 1}
                      className="flex size-8 shrink-0 items-center justify-center rounded-full transition-opacity disabled:opacity-30"
                      style={{ background: 'rgba(186,43,76,0.08)' }}
                    >
                      <Trash2 className="size-3.5" style={{ color: 'var(--danger)' }} />
                    </button>
                  </div>
                ))}
              </div>

              <button
                onClick={addMilestone}
                disabled={milestones.length >= 20}
                className="mb-5 flex w-full items-center justify-center gap-1.5 rounded-xl py-2 text-sm font-medium disabled:opacity-40"
                style={{ background: 'var(--surface-muted)', color: 'var(--ink-2)', border: '1px dashed var(--border)' }}
              >
                <Plus className="size-3.5" />
                Add milestone
              </button>

              {/* CTA */}
              <button
                disabled={!address || isPending || isConfirming}
                onClick={handleSubmit}
                className="w-full rounded-2xl py-3.5 text-sm font-semibold text-white transition-all hover:scale-[1.01] active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
                style={{ background: 'var(--accent)' }}
              >
                {!address ? 'Connect wallet first'
                  : wrongChain ? 'Switch to Arc Testnet'
                  : isPending ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirm in wallet...</span>
                  : isConfirming ? <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Confirming...</span>
                  : `Create agreement · ${total.toFixed(2)} USDC`}
              </button>
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
