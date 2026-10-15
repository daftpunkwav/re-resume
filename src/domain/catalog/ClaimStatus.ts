/**
 * @file ClaimStatus
 * @description Claim lifecycle states and the legal transitions between them.
 *
 * Constraints:
 * - rejected is terminal except for reopening. A rejected statement may be
 *   added again as a new claim; the partial unique index frees the key.
 */

export const CLAIM_STATUSES = ['confirmed', 'pending', 'rejected'] as const

export type ClaimStatus = (typeof CLAIM_STATUSES)[number]

export const CLAIM_TRANSITIONS: Readonly<Record<ClaimStatus, readonly ClaimStatus[]>> = {
  pending: ['confirmed', 'rejected'],
  confirmed: ['rejected'],
  rejected: ['pending'],
}

export function isClaimStatus(raw: string): raw is ClaimStatus {
  return (CLAIM_STATUSES as readonly string[]).includes(raw)
}

export function canTransition(from: ClaimStatus, to: ClaimStatus): boolean {
  return CLAIM_TRANSITIONS[from].includes(to)
}
