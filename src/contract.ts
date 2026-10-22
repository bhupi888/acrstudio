import artifact from '../contracts/out/MilestoneEscrow.sol/MilestoneEscrow.json'
import { getUsdc } from '@/onchain-facts'

export const ARC_TESTNET_CHAIN_ID = 5042002

export const MILESTONE_ESCROW = {
  address: '0xdc2a32b1ac670fae6328078ec936f99625b5349f' as `0x${string}`,
  abi: artifact.abi,
} as const

const usdcFact = getUsdc(ARC_TESTNET_CHAIN_ID)
if (!usdcFact) throw new Error('USDC not found for Arc Testnet')

export const USDC_ADDRESS = usdcFact.address as `0x${string}`
export const USDC_DECIMALS = usdcFact.decimals

// 48-hour dispute window in seconds (mirrors DISPUTE_WINDOW in the contract)
export const DISPUTE_WINDOW_SECONDS = 48 * 60 * 60
// 7-day arbiter timeout in seconds (mirrors ARBITER_TIMEOUT in the contract)
export const ARBITER_TIMEOUT_SECONDS = 7 * 24 * 60 * 60

export enum MilestoneStatus {
  Pending = 0,
  Submitted = 1,
  Released = 2,
  Cancelled = 3,
  Disputed = 4,
  AutoReleased = 5,
}

export const STATUS_LABELS: Record<MilestoneStatus, string> = {
  [MilestoneStatus.Pending]: 'Pending',
  [MilestoneStatus.Submitted]: 'Submitted',
  [MilestoneStatus.Released]: 'Released',
  [MilestoneStatus.Cancelled]: 'Cancelled',
  [MilestoneStatus.Disputed]: 'Disputed',
  [MilestoneStatus.AutoReleased]: 'Auto-Released',
}

export const STATUS_COLORS: Record<MilestoneStatus, string> = {
  [MilestoneStatus.Pending]: '#6b6580',
  [MilestoneStatus.Submitted]: '#92400e',
  [MilestoneStatus.Released]: '#1a8047',
  [MilestoneStatus.Cancelled]: '#ba2b4c',
  [MilestoneStatus.Disputed]: '#ba2b4c',
  [MilestoneStatus.AutoReleased]: '#1a8047',
}

export const STATUS_BG: Record<MilestoneStatus, string> = {
  [MilestoneStatus.Pending]: 'rgba(107,101,128,0.10)',
  [MilestoneStatus.Submitted]: 'rgba(146,64,14,0.10)',
  [MilestoneStatus.Released]: 'rgba(26,128,71,0.10)',
  [MilestoneStatus.Cancelled]: 'rgba(186,43,76,0.10)',
  [MilestoneStatus.Disputed]: 'rgba(186,43,76,0.14)',
  [MilestoneStatus.AutoReleased]: 'rgba(26,128,71,0.10)',
}

export interface MilestoneData {
  id: bigint
  description: string
  amount: bigint
  status: MilestoneStatus
  evidence: string
  submittedAt: bigint
  disputeDeadline: bigint
  disputed: boolean
}

export interface AgreementData {
  id: number
  client: string
  provider: string
  arbiter: string
  totalAmount: bigint
  fundedAmount: bigint
  funded: boolean
  cancelled: boolean
  milestones: MilestoneData[]
}

// ---- Industry templates ----
export interface MilestoneTemplate {
  description: string
  amount: string // display amount in USDC
}

export interface IndustryTemplate {
  id: string
  label: string
  milestones: MilestoneTemplate[]
}

export const INDUSTRY_TEMPLATES: IndustryTemplate[] = [
  {
    id: 'freelance-design',
    label: 'Freelance Design',
    milestones: [
      { description: 'Discovery & mood board', amount: '25' },
      { description: 'Wireframes & initial concepts', amount: '50' },
      { description: 'High-fidelity mockups', amount: '75' },
      { description: 'Final deliverables & handoff', amount: '50' },
    ],
  },
  {
    id: 'home-renovation',
    label: 'Home Renovation',
    milestones: [
      { description: 'Site inspection & planning', amount: '200' },
      { description: 'Materials procurement', amount: '500' },
      { description: 'Construction phase 1', amount: '800' },
      { description: 'Final finishing & sign-off', amount: '300' },
    ],
  },
  {
    id: 'software-mvp',
    label: 'Software MVP',
    milestones: [
      { description: 'Requirements & architecture doc', amount: '500' },
      { description: 'Backend API & database', amount: '1500' },
      { description: 'Frontend UI implementation', amount: '1000' },
      { description: 'Testing, QA & deployment', amount: '500' },
    ],
  },
  {
    id: 'content-creation',
    label: 'Content Creation',
    milestones: [
      { description: 'Content strategy & outline', amount: '100' },
      { description: 'Draft articles / scripts', amount: '200' },
      { description: 'Revisions & final copy', amount: '150' },
      { description: 'Publishing & reporting', amount: '50' },
    ],
  },
]
