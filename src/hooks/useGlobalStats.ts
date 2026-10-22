import { useReadContracts } from 'wagmi'
import { erc20Abi, type Abi } from 'viem'
import { MILESTONE_ESCROW, USDC_ADDRESS, ARC_TESTNET_CHAIN_ID } from '@/contract'

/**
 * Derives global stats from on-chain data.
 *
 * - totalLocked: the USDC ERC-20 balance of the escrow contract — exactly
 *   the sum of all unreleased funds currently held.
 * - totalReleased: we batch-read getAgreement for every id and sum
 *   (fundedAmount - unreleasedAmount) for each funded, non-cancelled agreement.
 *   This is best-effort and updates when the batch resolves.
 */
export function useGlobalStats(agreementCount: number) {
  // 1. USDC balance of the contract = total locked right now
  const balanceResult = useReadContracts({
    contracts: [{
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [MILESTONE_ESCROW.address],
      chainId: ARC_TESTNET_CHAIN_ID,
    }],
    query: { enabled: true },
  })

  // 2. Batch-read getAgreement for all IDs to compute totalReleased
  const ids = Array.from({ length: agreementCount }, (_, i) => i + 1)
  const agreementReads = useReadContracts({
    contracts: ids.map((id) => ({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi as Abi,
      functionName: 'getAgreement' as const,
      args: [BigInt(id)] as [bigint],
      chainId: ARC_TESTNET_CHAIN_ID,
    })),
    query: { enabled: agreementCount > 0 },
  })

  // 3. Batch-read getUnreleasedAmount for all IDs
  const unreleasedReads = useReadContracts({
    contracts: ids.map((id) => ({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi as Abi,
      functionName: 'getUnreleasedAmount' as const,
      args: [BigInt(id)] as [bigint],
      chainId: ARC_TESTNET_CHAIN_ID,
    })),
    query: { enabled: agreementCount > 0 },
  })

  const totalLocked = balanceResult.data?.[0]?.status === 'success'
    ? (balanceResult.data[0].result)
    : undefined

  // released = sum of (fundedAmount - unreleasedAmount) for funded, non-cancelled agreements
  let totalReleased: bigint | undefined = undefined
  if (agreementReads.data && unreleasedReads.data && agreementCount > 0) {
    totalReleased = 0n
    for (let i = 0; i < agreementCount; i++) {
      const agr = agreementReads.data[i]
      const unr = unreleasedReads.data[i]
      if (agr?.status === 'success' && unr?.status === 'success') {
        // getAgreement: (client, provider, arbiter, totalAmount, fundedAmount, funded, cancelled)
        const [, , , , fundedAmount, funded, cancelled] = agr.result as [string, string, string, bigint, bigint, boolean, boolean]
        const unreleased = unr.result as bigint
        if (funded && !cancelled) {
          totalReleased += fundedAmount - unreleased
        }
      }
    }
  }

  return {
    totalLocked,
    totalReleased,
    agreementCount,
    isLoading: balanceResult.isLoading || (agreementCount > 0 && (agreementReads.isLoading || unreleasedReads.isLoading)),
  }
}
