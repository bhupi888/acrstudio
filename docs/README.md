# Milestone Escrow — Full Documentation

A programmable USDC escrow for freelance and project-based work. Funds are locked
in a smart contract on Arc Testnet and released milestone by milestone only when
the client approves. An optional arbiter can resolve disputes.

---

## Deployed Contract

| Version | Address | Explorer |
|---------|---------|---------|
| v2 (current) | `0xdc2a32b1ac670fae6328078ec936f99625b5349f` | [View on Arc Testnet](https://explorer.testnet.arc.io/address/0xdc2a32b1ac670fae6328078ec936f99625b5349f) |
| v1 (deprecated) | `0xc2c2204fef392b06866324e3c3bdda16975742b0` | — |

- Constructor arg: USDC `0x3600000000000000000000000000000000000000` (Arc Testnet)
- Chain: Arc Testnet (chain ID 5042002)
- Compiler: Solidity `^0.8.20`, EVM `paris`

---

## What Changed in v2

| Feature | Detail |
|---------|--------|
| Evidence field | Provider must supply a note or URL when submitting a milestone |
| 48-hour dispute window | After submission, the client has 48 h to approve or raise a dispute |
| Optional arbiter | Set at creation; can split the milestone payment any way they choose |
| Auto-release | Anyone can call `claimAutoRelease` after the window closes with no dispute |
| Arbiter timeout | If the arbiter does not act within 7 days, anyone can force-refund to client |
| Industry templates | Frontend dropdown pre-fills Freelance Design, Home Renovation, Software MVP, Content Creation |
| Activity feed | Per-agreement timeline of all on-chain events |
| Deep links | Share a direct URL to any agreement (`?agreement=N`) |

---

## Money Flow

```
Client                     Contract                   Provider
  |                            |                          |
  |-- createAgreement -------->|                          |
  |-- approve USDC (ERC-20) -->|                          |
  |-- fundEscrow ------------->| (holds USDC)             |
  |                            |                          |
  |                            |<-- submitMilestone ------|
  |                            |    (with evidence)       |
  |                            |                          |
  |     48-hour window opens   |                          |
  |                            |                          |
  | Option A: client approves  |                          |
  |-- approveAndRelease ------>|-- USDC transfer -------->|
  |                            |                          |
  | Option B: client disputes  |                          |
  |-- raiseDispute ----------->|                          |
  |                            |<-- resolveDispute -------|  (arbiter)
  |                            |-- split USDC ----------->|  (partial/full)
  |<-- remainder refund -------|                          |
  |                            |                          |
  | Option C: window expires, no dispute                  |
  |         anyone calls claimAutoRelease                 |
  |                            |-- USDC transfer -------->|
  |                            |                          |
  | Option D: arbiter never acts (7-day timeout)          |
  |         anyone calls claimArbiterTimeout              |
  |<-- USDC refund ------------|                          |
  |                            |                          |
  | Client cancels remaining:  |                          |
  |-- cancelRemainingAndRefund>|-- all unreleased ------->| (back to client)
```

---

## Contract Functions

### Core (unchanged from v1)

| Function | Who | Description |
|----------|-----|-------------|
| `createAgreement(provider, arbiter, descriptions[], amounts[])` | Client | Creates an agreement. Pass `address(0)` for no arbiter. |
| `fundEscrow(agreementId)` | Client | Transfers full USDC total into the contract. Requires prior ERC-20 approve. |
| `cancelRemainingAndRefund(agreementId)` | Client | Refunds all unreleased + disputed milestones back to client. |
| `getAgreement(agreementId)` | Anyone | Returns `(client, provider, arbiter, totalAmount, fundedAmount, funded, cancelled)`. |
| `getMilestone(agreementId, milestoneId)` | Anyone | Returns `(id, description, amount, status, evidence, submittedAt, disputeDeadline, disputed)`. |

### v2 additions

| Function | Who | Description |
|----------|-----|-------------|
| `submitMilestone(agreementId, milestoneId, evidence)` | Provider | Marks milestone done. Evidence must be non-empty. Starts the 48-hour dispute window. |
| `approveAndRelease(agreementId, milestoneId)` | Client | Releases USDC to provider. Reverts if the 48-hour window is still open. |
| `raiseDispute(agreementId, milestoneId)` | Client | Raises a dispute within the window. Requires an arbiter to be set. |
| `resolveDispute(agreementId, milestoneId, releaseAmount)` | Arbiter | Splits milestone payment: `releaseAmount` to provider, remainder to client. |
| `claimAutoRelease(agreementId, milestoneId)` | Anyone | After 48-hour window with no dispute, sends USDC to provider. |
| `claimArbiterTimeout(agreementId, milestoneId)` | Anyone | After 7-day arbiter inaction, refunds disputed USDC to client. |

### Constants

| Constant | Value |
|----------|-------|
| `DISPUTE_WINDOW` | 48 hours |
| `ARBITER_TIMEOUT` | 7 days |
| `MAX_MILESTONES` | 20 |

---

## Milestone Statuses

| Status | Meaning |
|--------|---------|
| `Pending` | Not yet submitted by provider |
| `Submitted` | Provider submitted; dispute window open or closed |
| `Released` | Client approved; USDC sent to provider |
| `Cancelled` | Agreement was cancelled before release |
| `Disputed` | Client raised dispute; waiting for arbiter |
| `AutoReleased` | Dispute window expired with no action; USDC auto-sent to provider |

---

## Getting Test USDC

Use the "Get test USDC" button in the Arc Studio sidebar. It drips Arc Testnet USDC
to your connected wallet so you can test the full escrow flow without real funds.

---

## Local Development

```bash
bun install
bun run dev
```

### Build contracts

```bash
cd contracts && forge build
```

### Run contract tests (79 tests)

```bash
cd contracts && forge test -v
```

---

## Tech Stack

| Layer | Choice |
|-------|--------|
| Chain | Arc Testnet (chain ID 5042002) — USDC is the native gas token |
| Token | USDC `0x3600000000000000000000000000000000000000` (6 decimals) |
| Contract | Solidity 0.8.28, Foundry, OpenZeppelin 5.1.0 |
| Frontend | React 18, Vite, TypeScript, Tailwind CSS |
| Web3 | wagmi v2, viem, ConnectKit |
| Fonts | Space Grotesk (display), DM Sans (body) |

---

## Security

- Two independent audit passes (rule-corpus + functional) before each deployment
- Slither static analysis: 0 real findings after fix
- 79 Foundry unit + fuzz + invariant tests
- ReentrancyGuard on all state-changing functions that transfer tokens
- SafeERC20 for all USDC transfers
- Fund-lock vectors explicitly covered: no-arbiter dispute gate, cancel includes disputed milestones, 7-day arbiter timeout

---

## Industry Templates

The create-agreement sheet includes four pre-filled templates:

| Template | Milestones | Total USDC |
|----------|-----------|------------|
| Freelance Design | Discovery, Wireframes, Mockups, Handoff | 200 |
| Home Renovation | Inspection, Materials, Construction, Finishing | 1,800 |
| Software MVP | Architecture, Backend, Frontend, QA | 3,500 |
| Content Creation | Strategy, Drafts, Revisions, Publishing | 500 |

Amounts are editable after applying a template.
