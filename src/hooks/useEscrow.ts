import { useReadContract, useReadContracts, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { erc20Abi, type Abi } from 'viem'
import { MILESTONE_ESCROW, USDC_ADDRESS, ARC_TESTNET_CHAIN_ID, type MilestoneData, type AgreementData } from '@/contract'

// ---- Agreement reader ----
export function useAgreement(agreementId: number | null) {
  const chainId = ARC_TESTNET_CHAIN_ID

  const agreementResult = useReadContract({
    address: MILESTONE_ESCROW.address,
    abi: MILESTONE_ESCROW.abi,
    functionName: 'getAgreement',
    args: agreementId != null ? [BigInt(agreementId)] : undefined,
    chainId,
    query: { enabled: agreementId != null && agreementId > 0 },
  })

  const countResult = useReadContract({
    address: MILESTONE_ESCROW.address,
    abi: MILESTONE_ESCROW.abi,
    functionName: 'getMilestoneCount',
    args: agreementId != null ? [BigInt(agreementId)] : undefined,
    chainId,
    query: { enabled: agreementId != null && agreementId > 0 },
  })

  const unreleasedResult = useReadContract({
    address: MILESTONE_ESCROW.address,
    abi: MILESTONE_ESCROW.abi,
    functionName: 'getUnreleasedAmount',
    args: agreementId != null ? [BigInt(agreementId)] : undefined,
    chainId,
    query: { enabled: agreementId != null && agreementId > 0 },
  })

  return {
    // v2: getAgreement returns (client, provider, arbiter, totalAmount, fundedAmount, funded, cancelled)
    agreementData: agreementResult.data as [string, string, string, bigint, bigint, boolean, boolean] | undefined,
    milestoneCount: countResult.data as bigint | undefined,
    unreleasedAmount: unreleasedResult.data as bigint | undefined,
    isLoading: agreementResult.isLoading || countResult.isLoading,
    refetch: () => {
      void agreementResult.refetch()
      void countResult.refetch()
      void unreleasedResult.refetch()
    },
  }
}

// ---- Milestone batch reader ----
export function useMilestones(agreementId: number | null, count: number) {
  const chainId = ARC_TESTNET_CHAIN_ID

  const contracts = count > 0 && agreementId != null
    ? Array.from({ length: count }, (_, i) => ({
        address: MILESTONE_ESCROW.address,
        abi: MILESTONE_ESCROW.abi as Abi,
        functionName: 'getMilestone' as const,
        args: [BigInt(agreementId), BigInt(i)] as [bigint, bigint],
        chainId,
      }))
    : []

  const results = useReadContracts({
    contracts,
    query: { enabled: contracts.length > 0 },
  })

  const milestones: MilestoneData[] = results.data
    ? results.data
        .filter((r) => r.status === 'success' && r.result)
        .map((r) => {
          // v2: getMilestone returns (id, description, amount, status, evidence, submittedAt, disputeDeadline, disputed)
          const [id, description, amount, status, evidence, submittedAt, disputeDeadline, disputed] = r.result as [bigint, string, bigint, number, string, bigint, bigint, boolean]
          return { id, description, amount, status, evidence, submittedAt, disputeDeadline, disputed }
        })
    : []

  return { milestones, isLoading: results.isLoading, refetch: results.refetch }
}

// ---- Agreement count ----
export function useAgreementCount() {
  const result = useReadContract({
    address: MILESTONE_ESCROW.address,
    abi: MILESTONE_ESCROW.abi,
    functionName: 'agreementCount',
    chainId: ARC_TESTNET_CHAIN_ID,
  })
  return { count: result.data as bigint | undefined, refetch: result.refetch }
}

// ---- USDC balance ----
export function useUsdcBalance(address: string | undefined) {
  const result = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address as `0x${string}`] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!address },
  })
  return { balance: result.data, refetch: result.refetch }
}

// ---- USDC allowance ----
export function useUsdcAllowance(owner: string | undefined) {
  const result = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'allowance',
    args: owner ? [owner as `0x${string}`, MILESTONE_ESCROW.address] : undefined,
    chainId: ARC_TESTNET_CHAIN_ID,
    query: { enabled: !!owner },
  })
  return { allowance: result.data, refetch: result.refetch }
}

// ---- Write hooks ----
export function useCreateAgreement() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  // v2: createAgreement(provider, arbiter, descriptions, amounts)
  const create = (provider: string, arbiter: string, descriptions: string[], amounts: bigint[]) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'createAgreement',
      args: [provider as `0x${string}`, arbiter as `0x${string}`, descriptions, amounts],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { create, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useApproveUsdc() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const approve = (amount: bigint) => {
    writeContract({
      address: USDC_ADDRESS,
      abi: erc20Abi,
      functionName: 'approve',
      args: [MILESTONE_ESCROW.address, amount],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { approve, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useFundEscrow() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const fund = (agreementId: number) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'fundEscrow',
      args: [BigInt(agreementId)],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { fund, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useSubmitMilestone() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  // v2: submitMilestone(agreementId, milestoneId, evidence)
  const submit = (agreementId: number, milestoneId: number, evidence: string) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'submitMilestone',
      args: [BigInt(agreementId), BigInt(milestoneId), evidence],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { submit, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useApproveAndRelease() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const release = (agreementId: number, milestoneId: number) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'approveAndRelease',
      args: [BigInt(agreementId), BigInt(milestoneId)],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { release, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useCancelRefund() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const cancel = (agreementId: number) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'cancelRemainingAndRefund',
      args: [BigInt(agreementId)],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { cancel, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useRaiseDispute() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const raiseDispute = (agreementId: number, milestoneId: number) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'raiseDispute',
      args: [BigInt(agreementId), BigInt(milestoneId)],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { raiseDispute, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useResolveDispute() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  // releaseAmount: raw USDC units to release to provider (0 = full refund to client)
  const resolveDispute = (agreementId: number, milestoneId: number, releaseAmount: bigint) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'resolveDispute',
      args: [BigInt(agreementId), BigInt(milestoneId), releaseAmount],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { resolveDispute, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useClaimAutoRelease() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const claimAutoRelease = (agreementId: number, milestoneId: number) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'claimAutoRelease',
      args: [BigInt(agreementId), BigInt(milestoneId)],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { claimAutoRelease, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

export function useClaimArbiterTimeout() {
  const { writeContract, data: hash, isPending, isError, error, reset } = useWriteContract()
  const { isLoading: isConfirming, isSuccess } = useWaitForTransactionReceipt({ hash })

  const claimTimeout = (agreementId: number, milestoneId: number) => {
    writeContract({
      address: MILESTONE_ESCROW.address,
      abi: MILESTONE_ESCROW.abi,
      functionName: 'claimArbiterTimeout',
      args: [BigInt(agreementId), BigInt(milestoneId)],
      chainId: ARC_TESTNET_CHAIN_ID,
    })
  }

  return { claimTimeout, hash, isPending, isConfirming, isSuccess, isError, error, reset }
}

// ---- Combined agreement view ----
export function useAgreementFull(agreementId: number | null): {
  agreement: AgreementData | null
  unreleasedAmount: bigint | undefined
  isLoading: boolean
  refetch: () => void
} {
  const { agreementData, milestoneCount, unreleasedAmount, isLoading: agLoading, refetch: agRefetch } = useAgreement(agreementId)
  const count = milestoneCount != null ? Number(milestoneCount) : 0
  const { milestones, isLoading: msLoading, refetch: msRefetch } = useMilestones(agreementId, count)

  const agreement: AgreementData | null = agreementData && agreementId != null
    ? {
        id: agreementId,
        client: agreementData[0],
        provider: agreementData[1],
        arbiter: agreementData[2],
        totalAmount: agreementData[3],
        fundedAmount: agreementData[4],
        funded: agreementData[5],
        cancelled: agreementData[6],
        milestones,
      }
    : null

  return {
    agreement,
    unreleasedAmount,
    isLoading: agLoading || msLoading,
    refetch: () => { void agRefetch(); void msRefetch() },
  }
}
