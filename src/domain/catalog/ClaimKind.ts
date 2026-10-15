/**
 * @file ClaimKind
 * @description The three kinds of verifiable assertion. Metric and
 * responsibility claims are what make a draft reviewable against the source.
 */

export const CLAIM_KINDS = ['metric', 'responsibility', 'skill'] as const

export type ClaimKind = (typeof CLAIM_KINDS)[number]

export function isClaimKind(raw: string): raw is ClaimKind {
  return (CLAIM_KINDS as readonly string[]).includes(raw)
}
