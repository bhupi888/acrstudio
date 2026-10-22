export function formatAddress(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function formatUsdc(raw: bigint, decimals = 6): string {
  const factor = 10n ** BigInt(decimals)
  const whole = raw / factor
  const frac = raw % factor
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '')
  return fracStr ? `${whole}.${fracStr}` : whole.toString()
}

export function parseUsdc(value: string, decimals = 6): bigint {
  if (!value || value === '.') return 0n
  const [whole = '0', frac = ''] = value.split('.')
  const fracPadded = frac.padEnd(decimals, '0').slice(0, decimals)
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fracPadded || '0')
}

export function parseOnchainError(error: unknown): string {
  const message = (error as { message?: string })?.message?.toLowerCase() ?? ''
  if (message.includes('user rejected') || message.includes('denied')) return 'Transaction cancelled.'
  if (message.includes('insufficient funds') || message.includes('exceeds balance'))
    return 'Insufficient USDC balance.'
  if (message.includes('notclient')) return 'Only the client can do this.'
  if (message.includes('notprovider')) return 'Only the provider can do this.'
  if (message.includes('alreadyfunded')) return 'Agreement is already funded.'
  if (message.includes('notfunded')) return 'Agreement has not been funded yet.'
  if (message.includes('alreadycancelled')) return 'Agreement is already cancelled.'
  if (message.includes('invalidstatus')) return 'Milestone status does not allow this action.'
  if (message.includes('zeroamount')) return 'Milestone amount cannot be zero.'
  // v2 errors
  if (message.includes('emptyevidence')) return 'Evidence is required — add a note or URL.'
  if (message.includes('disputewindowclosed')) return 'The 48-hour dispute window has already closed.'
  if (message.includes('disputewindowopen')) return 'The dispute window is still open (48h after submission).'
  if (message.includes('notarbiter')) return 'Only the designated arbiter can do this.'
  if (message.includes('noarbiter')) return 'No arbiter was set for this agreement.'
  if (message.includes('notdisputed')) return 'This milestone is not in a disputed state.'
  if (message.includes('partialamountinvalid')) return 'Release amount must be between 0 and the milestone amount.'
  if (message.includes('reverted')) {
    const match = message.match(/reason="([^"]+)"/)
    return match ? `Transaction failed: ${match[1]}` : 'Transaction failed. Please try again.'
  }
  if (message.includes('network') || message.includes('timeout')) return 'Network error. Please retry.'
  return 'Something went wrong. Please try again.'
}
