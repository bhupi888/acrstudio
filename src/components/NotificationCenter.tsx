import { useState, useEffect, useRef, useReducer, useCallback } from 'react'
import { Bell, X, ExternalLink, ChevronRight } from 'lucide-react'
import { useAccount } from 'wagmi'
import { createPublicClient, http, parseAbiItem, type Log } from 'viem'
import { requireChain, buildTxExplorerUrl } from '@/onchain-facts'
import { MILESTONE_ESCROW, ARC_TESTNET_CHAIN_ID } from '@/contract'
import { formatAddress } from '@/utils'

const STORAGE_KEY = 'escrow-notifications-seen'

export interface Notification {
  id: string
  agreementId: number
  title: string
  body: string
  txHash: string
  timestamp: number
}

function loadSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, number>
  } catch {
    return {}
  }
}
function saveSeen(s: Record<string, number>) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
}

const EVENT_ABIS = [
  parseAbiItem('event AgreementCreated(uint256 indexed agreementId, address indexed client, address indexed provider, uint256 totalAmount)'),
  parseAbiItem('event EscrowFunded(uint256 indexed agreementId, address indexed client, uint256 amount)'),
  parseAbiItem('event MilestoneSubmitted(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider)'),
  parseAbiItem('event MilestoneReleased(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider, uint256 amount)'),
  parseAbiItem('event MilestoneDisputeRaised(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client)'),
  parseAbiItem('event MilestoneArbiterDecision(uint256 indexed agreementId, uint256 indexed milestoneId, uint256 releasedToProvider, uint256 refundedToClient)'),
  parseAbiItem('event MilestoneAutoReleased(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider, uint256 amount)'),
  parseAbiItem('event ArbiterTimeoutClaimed(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client, uint256 amount)'),
  parseAbiItem('event EscrowCancelled(uint256 indexed agreementId, address indexed client, uint256 refundAmount)'),
] as const

type LogWithMeta = Log & { eventName?: string; args?: Record<string, unknown> }

function labelEvent(log: LogWithMeta): { title: string; body: string } | null {
  const { eventName, args } = log
  if (!args) return null
  const id = Number(args['agreementId'] ?? 0)
  const mid = args['milestoneId'] !== undefined ? Number(args['milestoneId']) + 1 : null
  switch (eventName) {
    case 'AgreementCreated': return { title: `Agreement #${id} created`, body: `Client: ${formatAddress(String(args['client']))}` }
    case 'EscrowFunded': return { title: `Agreement #${id} funded`, body: `Escrow is now active` }
    case 'MilestoneSubmitted': return mid !== null ? { title: `Milestone ${mid} submitted`, body: `Agreement #${id} — awaiting review` } : null
    case 'MilestoneReleased': return mid !== null ? { title: `Milestone ${mid} released`, body: `Agreement #${id} — payment sent` } : null
    case 'MilestoneDisputeRaised': return mid !== null ? { title: `Dispute raised on milestone ${mid}`, body: `Agreement #${id} — arbiter required` } : null
    case 'MilestoneArbiterDecision': return mid !== null ? { title: `Arbiter resolved milestone ${mid}`, body: `Agreement #${id}` } : null
    case 'MilestoneAutoReleased': return mid !== null ? { title: `Milestone ${mid} auto-released`, body: `Agreement #${id} — 48h window expired` } : null
    case 'ArbiterTimeoutClaimed': return mid !== null ? { title: `Arbiter timeout on milestone ${mid}`, body: `Agreement #${id} — refunded to client` } : null
    case 'EscrowCancelled': return { title: `Agreement #${id} cancelled`, body: `Unreleased USDC refunded` }
    default: return null
  }
}

// Async fetch lives outside the component so it never triggers render rules
async function fetchNotifs(address: string): Promise<Notification[]> {
  const chainFact = requireChain(ARC_TESTNET_CHAIN_ID)
  const viemChain = {
    id: ARC_TESTNET_CHAIN_ID,
    name: chainFact.name ?? 'Arc Testnet',
    nativeCurrency: {
      name: chainFact.nativeCurrency.symbol,
      symbol: chainFact.nativeCurrency.symbol,
      decimals: chainFact.nativeCurrency.decimals,
    },
    rpcUrls: { default: { http: [chainFact.rpcUrls[0]] } },
  }
  const client = createPublicClient({ chain: viemChain, transport: http(chainFact.rpcUrls[0]) })
  const head = await client.getBlockNumber()
  const fromBlock = head > 50000n ? head - 50000n : 0n
  const logs = await client.getLogs({ address: MILESTONE_ESCROW.address, events: EVENT_ABIS, fromBlock, toBlock: 'latest' })
  return (logs as LogWithMeta[])
    .filter((log) => {
      const a = log.args ?? {}
      return ['client', 'provider', 'arbiter'].some(
        (key) => typeof a[key] === 'string' && (a[key]).toLowerCase() === address.toLowerCase()
      )
    })
    .slice(-50)
    .reverse()
    .reduce<Notification[]>((acc, log) => {
      const label = labelEvent(log)
      if (!label) return acc
      const hash = log.transactionHash ?? ''
      acc.push({ id: `${hash}-${log.logIndex ?? 0}`, agreementId: Number((log.args ?? {})['agreementId'] ?? 0), title: label.title, body: label.body, txHash: hash, timestamp: Date.now() })
      return acc
    }, [])
}

// Reducer-based state so useReducer dispatch (not setState) is called from effects
type State = { notifs: Notification[] }
type Action = { type: 'set'; notifs: Notification[] }
function reducer(_: State, action: Action): State {
  return { notifs: action.notifs }
}

export default function NotificationCenter({ onSelectAgreement }: { onSelectAgreement: (id: number) => void }) {
  const { address } = useAccount()
  const [open, setOpen] = useState(false)
  const [state, dispatch] = useReducer(reducer, { notifs: [] })
  const [seen, setSeen] = useState<Record<string, number>>(loadSeen)
  const panelRef = useRef<HTMLDivElement>(null)

  const notifications = state.notifs
  const unreadCount = notifications.filter((n) => (seen[n.id] ?? 0) < n.timestamp).length

  // Poll for notifications; dispatch (not setState) is stable and allowed in effects
  const refresh = useCallback(() => {
    if (!address) return
    void fetchNotifs(address).then((notifs) => dispatch({ type: 'set', notifs })).catch(() => undefined)
  }, [address])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, 30_000)
    return () => clearInterval(timer)
  }, [refresh])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const markAllRead = () => {
    const next: Record<string, number> = {}
    notifications.forEach((n) => { next[n.id] = Date.now() })
    setSeen(next)
    saveSeen(next)
  }

  if (!address) return null

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => { setOpen((v) => !v); if (!open) markAllRead() }}
        className="relative flex size-9 items-center justify-center rounded-xl transition-all hover:opacity-80 active:scale-95"
        style={{ border: '1px solid var(--border)' }}
        aria-label="Notifications"
      >
        <Bell className="size-4" style={{ color: 'var(--ink-2)' }} />
        {unreadCount > 0 && (
          <span className="absolute -right-1 -top-1 flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: 'var(--danger)' }}>
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-2xl"
          style={{ background: 'var(--bg)', border: '1px solid var(--border)', boxShadow: '0 8px 40px rgba(0,0,0,0.16)' }}
        >
          <div className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--ink)' }}>Notifications</span>
            <button onClick={() => setOpen(false)} className="flex size-6 items-center justify-center rounded-lg hover:opacity-70">
              <X className="size-3.5" style={{ color: 'var(--subtle)' }} />
            </button>
          </div>

          <div className="max-h-80 overflow-y-auto">
            {notifications.length === 0
              ? <div className="px-4 py-8 text-center text-sm" style={{ color: 'var(--subtle)' }}>No notifications yet</div>
              : notifications.map((n) => (
                <button
                  key={n.id}
                  onClick={() => { onSelectAgreement(n.agreementId); setOpen(false) }}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:opacity-80"
                  style={{ borderBottom: '1px solid var(--border)' }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold leading-snug" style={{ color: 'var(--ink)' }}>{n.title}</p>
                    <p className="text-xs" style={{ color: 'var(--muted)' }}>{n.body}</p>
                    {n.txHash && (
                      <a href={buildTxExplorerUrl(ARC_TESTNET_CHAIN_ID, n.txHash as `0x${string}`)} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()} className="mt-0.5 inline-flex items-center gap-0.5 text-[10px]" style={{ color: 'var(--accent-hover)' }}>
                        View tx <ExternalLink className="size-2.5" />
                      </a>
                    )}
                  </div>
                  <ChevronRight className="mt-0.5 size-3.5 shrink-0" style={{ color: 'var(--subtle)' }} />
                </button>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}
