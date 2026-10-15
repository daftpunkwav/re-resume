/**
 * @file branded-id
 * @description Nominal typing for every identifier in the domain. Branding is
 * what stops an ExperienceId from being passed where a VariantId belongs.
 *
 * Constraints:
 * - Brand values cannot be constructed by literal assignment; use the
 *   repository/mapper layer or the assert functions below.
 */

declare const brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [brand]: B }

export type ExperienceId = Brand<string, 'ExperienceId'>
export type VariantId = Brand<string, 'VariantId'>
export type ClaimId = Brand<string, 'ClaimId'>
export type ResumeId = Brand<string, 'ResumeId'>
export type BlockId = Brand<string, 'BlockId'>
export type RevisionId = Brand<string, 'RevisionId'>
export type SnapshotId = Brand<string, 'SnapshotId'>
export type AgentRunId = Brand<string, 'AgentRunId'>
export type ToolInvocationId = Brand<string, 'ToolInvocationId'>
export type AssetId = Brand<string, 'AssetId'>
export type ProfileId = Brand<string, 'ProfileId'>
export type JobPostingId = Brand<string, 'JobPostingId'>

/**
 * Row-to-domain reconstruction. The only place a raw string becomes a branded
 * identifier, so a malformed row fails here rather than deep inside a use case.
 */
export function asExperienceId(raw: string): ExperienceId {
  return raw as ExperienceId
}

export function asVariantId(raw: string): VariantId {
  return raw as VariantId
}

export function asClaimId(raw: string): ClaimId {
  return raw as ClaimId
}

export function asResumeId(raw: string): ResumeId {
  return raw as ResumeId
}

export function asBlockId(raw: string): BlockId {
  return raw as BlockId
}

export function asRevisionId(raw: string): RevisionId {
  return raw as RevisionId
}

export function asSnapshotId(raw: string): SnapshotId {
  return raw as SnapshotId
}

export function asAgentRunId(raw: string): AgentRunId {
  return raw as AgentRunId
}

export function asToolInvocationId(raw: string): ToolInvocationId {
  return raw as ToolInvocationId
}

export function asAssetId(raw: string): AssetId {
  return raw as AssetId
}

export function asProfileId(raw: string): ProfileId {
  return raw as ProfileId
}

export function asJobPostingId(raw: string): JobPostingId {
  return raw as JobPostingId
}
