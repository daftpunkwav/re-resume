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
