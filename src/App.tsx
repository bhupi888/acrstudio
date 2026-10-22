import { useState, useEffect, useRef } from 'react'
import { ConnectKitButton } from 'connectkit'
import { useAccount } from 'wagmi'
import { Plus, Sun, Moon } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useAgreementCount, useUsdcBalance } from '@/hooks/useEscrow'
import { ARC_TESTNET_CHAIN_ID, MILESTONE_ESCROW } from '@/contract'
import { formatUsdc, formatAddress } from '@/utils'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import AgreementList from '@/components/AgreementList'
import AgreementView from '@/components/AgreementView'
import CreateAgreementSheet from '@/components/CreateAgreementSheet'
import FilterBar, { type AgreementFilter } from '@/components/FilterBar'
import StatsBar from '@/components/StatsBar'
import NotificationCenter from '@/components/NotificationCenter'
import { useTheme } from '@/hooks/useTheme'
import { useKeyboardShortcuts } from '@/hooks/useKeyboardShortcuts'

// Read ?agreement=N from URL on load
function readDeepLink(): number | null {
  const params = new URLSearchParams(window.location.search)
  const v = params.get('agreement')
  if (!v) return null
  const n = parseInt(v, 10)
  return isNaN(n) || n <= 0 ? null : n
}

export default function App() {
  const { address, isConnected, chainId } = useAccount()
  const { count, refetch: refetchCount } = useAgreementCount()
  const { balance, refetch: refetchBalance } = useUsdcBalance(address)
  const { isDark, toggle: toggleTheme } = useTheme()

  const [selectedId, setSelectedId] = useState<number | null>(readDeepLink)
  const [showCreate, setShowCreate] = useState(false)
  const [filter, setFilter] = useState<AgreementFilter>('all')
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const wrongChain = isConnected && chainId !== ARC_TESTNET_CHAIN_ID
  const agreementCount = count ? Number(count) : 0

  useKeyboardShortcuts({
    onNew: isConnected && !selectedId ? () => setShowCreate(true) : undefined,
    onBack: selectedId ? () => { setSelectedId(null); handleAction() } : showCreate ? () => setShowCreate(false) : undefined,
    onSearch: !selectedId ? () => searchRef.current?.focus() : undefined,
    onToggleTheme: toggleTheme,
  })

  // Sync URL when navigating to/from an agreement
  useEffect(() => {
    const url = new URL(window.location.href)
    if (selectedId) {
      url.searchParams.set('agreement', String(selectedId))
    } else {
      url.searchParams.delete('agreement')
    }
    window.history.replaceState(null, '', url.toString())
  }, [selectedId])

  const handleAction = () => {
    void refetchCount()
    void refetchBalance()
  }

  return (
    <div className="min-h-dvh" style={{ background: 'var(--bg-gradient)' }}>
      {/* Header */}
      <header
        className="sticky top-0 z-40 border-b"
        style={{ background: 'var(--surface-strong)', backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)', borderColor: 'var(--border)' }}
      >
        <div className="mx-auto flex max-w-lg items-center justify-between px-4 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex size-8 items-center justify-center rounded-xl" style={{ background: 'var(--accent)' }}>
              <TokenUSDC size={18} variant="branded" />
            </div>
            <div>
              <h1 className="display text-base font-bold leading-tight" style={{ color: 'var(--ink)' }}>Milestone Escrow</h1>
              <p className="text-[10px] font-medium" style={{ color: 'var(--subtle)' }}>Arc Testnet · USDC</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NotificationCenter onSelectAgreement={(id) => { setSelectedId(id) }} />
            <button
              onClick={toggleTheme}
              className="flex size-9 items-center justify-center rounded-xl transition-all hover:opacity-80 active:scale-95"
              style={{ border: '1px solid var(--border)' }}
              aria-label="Toggle dark mode"
              title={isDark ? 'Switch to light mode (D)' : 'Switch to dark mode (D)'}
            >
              {isDark
                ? <Sun className="size-4" style={{ color: 'var(--ink-2)' }} />
                : <Moon className="size-4" style={{ color: 'var(--ink-2)' }} />}
            </button>
            <ConnectKitButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-4 py-6">
        {/* Wrong chain banner */}
        {wrongChain && (
          <div className="mb-4 rounded-2xl px-4 py-3 text-sm font-medium" style={{ background: 'rgba(146,64,14,0.10)', color: '#92400e', border: '1px solid rgba(146,64,14,0.20)' }}>
            Please switch to Arc Testnet (chain ID 5042002) to use this app.
          </div>
        )}

        {!isConnected ? (
          /* Landing state */
          <div className="mt-8 text-center">
            <div
              className="mx-auto mb-6 flex size-20 items-center justify-center rounded-3xl"
              style={{ background: 'rgba(255,255,255,0.80)', border: '1px solid var(--border)', boxShadow: '0 4px 24px rgba(18,45,69,0.08)' }}
            >
              <TokenUSDC size={40} variant="branded" />
            </div>
            <h2 className="display mb-2 text-3xl font-bold text-balance" style={{ color: 'var(--ink)', letterSpacing: '-0.03em' }}>
              Milestone Escrow
            </h2>
            <p className="mx-auto mb-6 max-w-xs text-sm leading-relaxed text-pretty" style={{ color: 'var(--muted)' }}>
              Programmable USDC payments for freelance work. Funds are held in escrow and released milestone by milestone, with optional dispute resolution.
            </p>
            <ConnectKitButton />

            <div className="mt-10 grid grid-cols-2 gap-3">
              {[
                { label: 'Create', desc: 'Set milestones, amounts, and an optional arbiter' },
                { label: 'Fund', desc: 'Deposit the total amount in USDC' },
                { label: 'Release', desc: 'Approve each milestone as work is done' },
                { label: 'Dispute', desc: '48h window to raise a dispute, arbiter decides the split' },
              ].map((step, i) => (
                <div key={i} className="rounded-2xl p-3 text-left" style={{ background: 'rgba(255,255,255,0.70)', border: '1px solid var(--border)' }}>
                  <div className="mb-1 flex size-7 items-center justify-center rounded-lg text-xs font-bold text-white" style={{ background: 'var(--accent)' }}>
                    {i + 1}
                  </div>
                  <div className="text-xs font-semibold" style={{ color: 'var(--ink)' }}>{step.label}</div>
                  <div className="text-xs" style={{ color: 'var(--subtle)' }}>{step.desc}</div>
                </div>
              ))}
            </div>
          </div>
        ) : selectedId ? (
          /* Agreement detail */
          <AgreementView
            agreementId={selectedId}
            onBack={() => { setSelectedId(null); handleAction() }}
          />
        ) : (
          /* Agreement list */
          <>
            {/* Balance card */}
            <div
              className="mb-4 rounded-3xl p-5"
              style={{ background: 'rgba(255,255,255,0.80)', backdropFilter: 'blur(20px)', border: '1px solid var(--border)', boxShadow: '0 2px 20px rgba(18,45,69,0.06)' }}
            >
              <div className="mb-1 flex items-center gap-1.5">
                <div className="flex size-5 items-center justify-center rounded-md" style={{ background: 'rgba(26,128,71,0.12)' }}>
                  <TokenUSDC size={12} variant="branded" />
                </div>
                <span className="text-xs font-semibold" style={{ color: 'var(--muted)' }}>Your USDC balance</span>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="display text-4xl font-bold tabular-nums" style={{ color: 'var(--ink)' }}>
                  {balance !== undefined ? formatUsdc(balance) : '—'}
                </span>
                <span className="text-lg font-medium" style={{ color: 'var(--subtle)' }}>USDC</span>
              </div>
              <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
                {address ? formatAddress(address) : ''} · Arc Testnet
              </p>
            </div>

            {/* Agreements header */}
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-semibold" style={{ color: 'var(--ink)' }}>
                Agreements {agreementCount > 0 && <span style={{ color: 'var(--subtle)' }}>({agreementCount})</span>}
              </h2>
              <button
                onClick={() => setShowCreate(true)}
                className="flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold text-white transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: 'var(--accent)' }}
              >
                <Plus className="size-3.5" /> New
              </button>
            </div>

            {/* Global stats */}
            {agreementCount > 0 && <StatsBar agreementCount={agreementCount} />}

            {/* Search + filter bar */}
            {agreementCount > 0 && (
              <FilterBar
                search={search}
                onSearch={setSearch}
                filter={filter}
                onFilter={setFilter}
                inputRef={searchRef}
              />
            )}

            <AgreementList
              count={agreementCount}
              onSelect={setSelectedId}
              onNew={() => setShowCreate(true)}
              filter={filter}
              search={search}
            />

            {/* Contract link */}
            <div className="mt-6 text-center">
              <a
                href={buildAddressExplorerUrl(ARC_TESTNET_CHAIN_ID, MILESTONE_ESCROW.address)}
                target="_blank"
                rel="noreferrer"
                className="mono text-xs"
                style={{ color: 'var(--subtle)' }}
              >
                Contract: {formatAddress(MILESTONE_ESCROW.address)}
              </a>
            </div>
          </>
        )}
      </main>

      <CreateAgreementSheet
        open={showCreate}
        onClose={() => setShowCreate(false)}
        onCreated={(_id) => {
          setShowCreate(false)
          handleAction()
        }}
      />
    </div>
  )
}
