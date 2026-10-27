/**
 * @file branded-id
 * @description Nominal typing for every identifier in the domain. Branding is
 * what stops an InfoEntryId from being passed where a ResumeId belongs.
 *
 * Responsibilities:
 * - Declare the identifier set of the current domain model
 * - Provide the single row-to-domain reconstruction functions
 *
 * Constraints:
 * - Brand values cannot be constructed by literal assignment; use the
 *   reconstruction functions below at the persistence boundary.
 * - The legacy identifiers stay until the modules that still declare them are
 *   deleted; no new code may reference them.
 */

declare const brand: unique symbol

export type Brand<T, B extends string> = T & { readonly [brand]: B }

// Information library.
export type InfoEntryId = Brand<string, 'InfoEntryId'>
export type CustomModuleId = Brand<string, 'CustomModuleId'>
export type CustomFieldKey = Brand<string, 'CustomFieldKey'>

// Resume document.
export type ResumeId = Brand<string, 'ResumeId'>
export type ResumeSectionId = Brand<string, 'ResumeSectionId'>
export type ResumeOverrideId = Brand<string, 'ResumeOverrideId'>
export type CanvasBlockId = Brand<string, 'CanvasBlockId'>
export type TemplateId = Brand<string, 'TemplateId'>

// Derived at materialisation time, never persisted.
export type LayoutBlockId = Brand<string, 'LayoutBlockId'>

// Revision chain and frozen snapshots.
export type RevisionId = Brand<string, 'RevisionId'>
export type SnapshotId = Brand<string, 'SnapshotId'>

// Conversation, messages and attachments.
export type ConversationId = Brand<string, 'ConversationId'>
export type MessageId = Brand<string, 'MessageId'>
export type AttachmentId = Brand<string, 'AttachmentId'>

// Job postings and agent runs.
export type JobPostingId = Brand<string, 'JobPostingId'>
export type AgentRunId = Brand<string, 'AgentRunId'>
export type ToolInvocationId = Brand<string, 'ToolInvocationId'>

// Library change log.
export type ChangeRecordId = Brand<string, 'ChangeRecordId'>

/** Row-to-domain reconstruction. */
export function asInfoEntryId(raw: string): InfoEntryId {
  return raw as InfoEntryId
}

export function asCustomModuleId(raw: string): CustomModuleId {
  return raw as CustomModuleId
}

export function asCustomFieldKey(raw: string): CustomFieldKey {
  return raw as CustomFieldKey
}

export function asResumeId(raw: string): ResumeId {
  return raw as ResumeId
}

export function asResumeSectionId(raw: string): ResumeSectionId {
  return raw as ResumeSectionId
}

export function asResumeOverrideId(raw: string): ResumeOverrideId {
  return raw as ResumeOverrideId
}

export function asCanvasBlockId(raw: string): CanvasBlockId {
  return raw as CanvasBlockId
}

export function asLayoutBlockId(raw: string): LayoutBlockId {
  return raw as LayoutBlockId
}

export function asTemplateId(raw: string): TemplateId {
  return raw as TemplateId
}

export function asRevisionId(raw: string): RevisionId {
  return raw as RevisionId
}

export function asSnapshotId(raw: string): SnapshotId {
  return raw as SnapshotId
}

export function asConversationId(raw: string): ConversationId {
  return raw as ConversationId
}

export function asMessageId(raw: string): MessageId {
  return raw as MessageId
}

export function asAttachmentId(raw: string): AttachmentId {
  return raw as AttachmentId
}

export function asJobPostingId(raw: string): JobPostingId {
  return raw as JobPostingId
}

export function asAgentRunId(raw: string): AgentRunId {
  return raw as AgentRunId
}

export function asToolInvocationId(raw: string): ToolInvocationId {
  return raw as ToolInvocationId
}

export function asChangeRecordId(raw: string): ChangeRecordId {
  return raw as ChangeRecordId
}

/**
 * Identifiers of the v1 model that is being replaced.
 *
 * @deprecated Only the v1 modules that are deleted by their owning changes may
 * use these; the current model uses the identifiers above.
 */
export type ExperienceId = Brand<string, 'ExperienceId'>

/** @deprecated See `ExperienceId`. */
export type VariantId = Brand<string, 'VariantId'>

/** @deprecated See `ExperienceId`. */
export type ClaimId = Brand<string, 'ClaimId'>

/** @deprecated See `ExperienceId`. */
export type BlockId = Brand<string, 'BlockId'>

/** @deprecated See `ExperienceId`. */
export type ProfileId = Brand<string, 'ProfileId'>

/** @deprecated See `ExperienceId`. */
export type AssetId = Brand<string, 'AssetId'>

/** @deprecated See `ExperienceId`. */
export function asExperienceId(raw: string): ExperienceId {
  return raw as ExperienceId
}

/** @deprecated See `ExperienceId`. */
export function asVariantId(raw: string): VariantId {
  return raw as VariantId
}

/** @deprecated See `ExperienceId`. */
export function asClaimId(raw: string): ClaimId {
  return raw as ClaimId
}

/** @deprecated See `ExperienceId`. */
export function asBlockId(raw: string): BlockId {
  return raw as BlockId
}

/** @deprecated See `ExperienceId`. */
export function asProfileId(raw: string): ProfileId {
  return raw as ProfileId
}

/** @deprecated See `ExperienceId`. */
export function asAssetId(raw: string): AssetId {
  return raw as AssetId
}
