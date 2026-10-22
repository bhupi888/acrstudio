import { useEffect, useReducer } from 'react'
import { createPublicClient, http, parseAbiItem, type Log } from 'viem'
import { requireChain } from '@/onchain-facts'
import { MILESTONE_ESCROW, ARC_TESTNET_CHAIN_ID } from '@/contract'

export interface AgreementEvent {
  type: string
  label: string
  detail?: string
  blockNumber: bigint
  txHash: `0x${string}`
}

const chainFact = requireChain(ARC_TESTNET_CHAIN_ID)

const viemChain = {
  id: chainFact.chainId,
  name: chainFact.name,
  nativeCurrency: {
    name: chainFact.name,        // viem requires this field
    symbol: chainFact.nativeCurrency.symbol,
    decimals: chainFact.nativeCurrency.decimals,
  },
  rpcUrls: { default: { http: [chainFact.rpcUrls[0]] as [string, ...string[]] } },
} as const

const publicClient = createPublicClient({
  chain: viemChain,
  transport: http(chainFact.rpcUrls[0]),
})

const EVENT_ABIS = [
  parseAbiItem('event EscrowFunded(uint256 indexed agreementId, address indexed client, uint256 amount)'),
  parseAbiItem('event MilestoneSubmitted(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider)'),
  parseAbiItem('event MilestoneReleased(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider, uint256 amount)'),
  parseAbiItem('event EscrowCancelled(uint256 indexed agreementId, address indexed client, uint256 refundAmount)'),
  parseAbiItem('event MilestoneDisputeRaised(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client)'),
  parseAbiItem('event MilestoneArbiterDecision(uint256 indexed agreementId, uint256 indexed milestoneId, uint256 releasedToProvider, uint256 refundedToClient)'),
  parseAbiItem('event MilestoneAutoReleased(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed provider, uint256 amount)'),
  parseAbiItem('event ArbiterTimeoutClaimed(uint256 indexed agreementId, uint256 indexed milestoneId, address indexed client, uint256 amount)'),
]

function labelFromLog(log: Log & { eventName?: string; args?: Record<string, unknown> }): { label: string; detail?: string } {
  const args = (log.args ?? {})
  const msId = args.milestoneId !== undefined ? `M${Number(args.milestoneId) + 1}` : undefined

  switch (log.eventName) {
    case 'EscrowFunded':
      return { label: 'Escrow funded' }
    case 'MilestoneSubmitted':
      return { label: `${msId ?? 'Milestone'} submitted` }
    case 'MilestoneReleased': {
      const amt = args.amount as bigint | undefined
      return { label: `${msId ?? 'Milestone'} released`, detail: amt ? `${formatCompact(amt)} USDC` : undefined }
    }
    case 'EscrowCancelled': {
      const amt = args.refundAmount as bigint | undefined
      return { label: 'Agreement cancelled', detail: amt ? `${formatCompact(amt)} USDC refunded` : undefined }
    }
    case 'MilestoneDisputeRaised':
      return { label: `${msId ?? 'Milestone'} disputed` }
    case 'MilestoneArbiterDecision': {
      const rel = args.releasedToProvider as bigint | undefined
      const ref = args.refundedToClient as bigint | undefined
      return {
        label: `${msId ?? 'Milestone'} dispute resolved`,
        detail: `${formatCompact(rel ?? 0n)} to provider · ${formatCompact(ref ?? 0n)} refunded`,
      }
    }
    case 'MilestoneAutoReleased':
      return { label: `${msId ?? 'Milestone'} auto-released` }
    case 'ArbiterTimeoutClaimed':
      return { label: `${msId ?? 'Milestone'} arbiter timeout claimed` }
    default:
      return { label: log.eventName ?? 'Event' }
  }
}

function formatCompact(raw: bigint): string {
  const n = Number(raw) / 1e6
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; events: AgreementEvent[] }

type Action =
  | { type: 'start' }
  | { type: 'done'; events: AgreementEvent[] }

function reducer(_: State, action: Action): State {
  if (action.type === 'start') return { status: 'loading' }
  return { status: 'done', events: action.events }
}

export function useAgreementEvents(agreementId: number | null) {
  const [state, dispatch] = useReducer(reducer, { status: 'idle' })

  useEffect(() => {
    if (agreementId == null || agreementId <= 0) return
    let cancelled = false
    dispatch({ type: 'start' })

    const fetchEvents = async () => {
      try {
        const idBig = BigInt(agreementId)
        const allLogs: AgreementEvent[] = []

        await Promise.all(
          EVENT_ABIS.map(async (abi) => {
            try {
              const logs = await publicClient.getLogs({
                address: MILESTONE_ESCROW.address,
                event: abi,
                args: { agreementId: idBig } as Record<string, unknown>,
                fromBlock: 0n,
                toBlock: 'latest',
              })
              for (const log of logs) {
                const typed = log as Log & { eventName?: string; args?: Record<string, unknown> }
                const { label, detail } = labelFromLog(typed)
                allLogs.push({
                  type: typed.eventName ?? 'event',
                  label,
                  detail,
                  blockNumber: log.blockNumber ?? 0n,
                  txHash: log.transactionHash ?? '0x',
                })
              }
            } catch {
              // no logs for this event type — skip
            }
          })
        )

        if (cancelled) return
        allLogs.sort((a, b) => (a.blockNumber < b.blockNumber ? -1 : a.blockNumber > b.blockNumber ? 1 : 0))
        dispatch({ type: 'done', events: allLogs })
      } catch {
        if (!cancelled) dispatch({ type: 'done', events: [] })
      }
    }

    void fetchEvents()
    return () => { cancelled = true }
  }, [agreementId])

  return {
    events: state.status === 'done' ? state.events : [],
    isLoading: state.status === 'loading',
  }
}
