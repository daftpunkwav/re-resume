/**
 * @file jobPostingTools
 * @description The job-posting part of the tool pack: create the stored posting
 * (pasted text, or a screenshot the model transcribes), then run the existing
 * extraction use case so the structured requirements keep their run provenance.
 *
 * Responsibilities:
 * - Store a posting with its conversation and run attribution
 * - Transcribe an image posting through the configured model when it accepts
 *   image parts, and refuse a format this build cannot read
 * - Map the extraction failure kinds into the failure text the model reads
 *
 * Constraints:
 * - The parse itself is not reimplemented here: `parseJobPosting` owns the model
 *   call, the JSON extraction and the grounding rule.
 * - A posting row is written before the model call, so a failed parse still
 *   leaves the text the user supplied.
 */

import type { Attachment } from '../../../domain/conversation/Attachment'
import type { JobPosting, ParsedJobPosting } from '../../../domain/generation/JobPosting'
import type { AgentRunRepository } from '../../../domain/generation/ports/AgentRunRepository'
import type { JobPostingRepository } from '../../../domain/generation/ports/JobPostingRepository'
import type { ModelProvider } from '../../../domain/generation/ports/ModelProvider'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import type { Clock } from '../../../domain/shared/Clock'
import type { IdGenerator } from '../../../domain/shared/IdGenerator'
import { asJobPostingId } from '../../../domain/shared/branded-id'
import type { AttachmentId, JobPostingId } from '../../../domain/shared/branded-id'
import { DomainError } from '../../../domain/shared/DomainError'
import { parseJobPosting } from '../../job/parseJobPosting'
import type { JobPostingParseFailure } from '../../job/parseJobPosting'
import { toolFailure } from './toolSchema'
import type { ToolFailure } from './toolSchema'

/** Longest pasted description accepted by the tool, in code points. */
export const JOB_DESCRIPTION_MAX_LENGTH = 20_000

export interface JobPostingToolDeps {
  readonly model: ModelProvider
  readonly jobPostings: JobPostingRepository
  readonly runs: AgentRunRepository
  readonly clock: Clock
  readonly ids: IdGenerator
}

export interface AnalyzeJobDescriptionInput {
  readonly text?: string
  readonly attachmentId?: AttachmentId
}

export interface AnalyzeJobDescriptionOutput {
  readonly jobPostingId: JobPostingId
  readonly parsed: ParsedJobPosting | null
}

const TRANSCRIPTION_PROMPT = [
  '把这张图片中的岗位描述完整转写为纯文本。',
  '保留原文的岗位名称、职责、要求与关键词，不要总结，不要添加图片里没有的内容。',
  '只回复转写后的文本。',
].join('\n')

/**
 * Creates the posting, parses it and returns the stored parse. A parse failure is
 * returned as a readable result instead of thrown, so the model can correct the
 * input (paste the text, or supply a clearer screenshot).
 */
export async function analyzeJobDescription(
  deps: JobPostingToolDeps,
  context: ToolContext,
  input: AnalyzeJobDescriptionInput,
): Promise<AnalyzeJobDescriptionOutput | ToolFailure> {
  const pasted = input.text?.trim() ?? ''
  if (pasted === '') {
    if (input.attachmentId === undefined) {
      throw new DomainError('blankRequiredField', '岗位描述需要文本或附件。', {
        entity: 'jobPosting',
        id: '',
        blockers: ['text'],
      })
    }
    const attachment = await loadAttachment(context, input.attachmentId)
    const rawText = await transcribeAttachment(context, deps.model, attachment)
    return storeAndParse(deps, context, {
      rawText,
      source: 'image',
      imageAttachmentIds: [attachment.id],
    })
  }
  if ([...pasted].length > JOB_DESCRIPTION_MAX_LENGTH) {
    throw new DomainError(
      'fieldTooLong',
      `岗位描述最多 ${JOB_DESCRIPTION_MAX_LENGTH.toString()} 个字符。`,
      { entity: 'jobPosting', id: '', blockers: ['text'] },
    )
  }
  return storeAndParse(deps, context, {
    rawText: pasted,
    source: 'paste',
    imageAttachmentIds: [],
  })
}

async function loadAttachment(context: ToolContext, attachmentId: AttachmentId): Promise<Attachment> {
  const attachment = await context.attachments.findById(attachmentId)
  if (attachment === null) {
    throw new DomainError('attachmentNotFound', '附件不存在。', {
      entity: 'attachment',
      id: attachmentId,
      blockers: [attachmentId],
    })
  }
  return attachment
}

/** Reads the bytes and asks a vision-capable model for the full text. */
async function transcribeAttachment(
  context: ToolContext,
  model: ModelProvider,
  attachment: Attachment,
): Promise<string> {
  if (attachment.kind !== 'image' || !attachment.mimeType.startsWith('image/')) {
    throw new DomainError(
      'invalidFieldValue',
      '当前版本只能读取图片格式的岗位描述，请粘贴文本或改用图片。',
      { entity: 'attachment', id: attachment.id, blockers: [attachment.id] },
    )
  }
  if (!model.supportsImages) {
    throw new DomainError(
      'unsupportedImageType',
      '当前模型不支持图片输入，请粘贴岗位描述文本，或在设置中切换支持图片的模型。',
      { entity: 'attachment', id: attachment.id, blockers: [attachment.id] },
    )
  }
  const bytes = await context.fileStore.read(attachment.storageName)
  const request = {
    system: null,
    messages: [
      {
        role: 'user' as const,
        parts: [
          { kind: 'text' as const, text: TRANSCRIPTION_PROMPT },
          {
            kind: 'image' as const,
            mimeType: attachment.mimeType,
            base64: toBase64(bytes),
          },
        ],
      },
    ],
  }
  let answer = ''
  try {
    for await (const chunk of model.stream(request, [])) {
      if (chunk.type === 'text') answer += chunk.textDelta
    }
  } catch (failure) {
    throw new DomainError(
      'invalidFieldValue',
      `图片岗位描述转写失败：${failure instanceof Error ? failure.message : String(failure)}`,
      { entity: 'attachment', id: attachment.id, blockers: [attachment.id] },
    )
  }
  const text = answer.trim()
  if (text === '') {
    throw new DomainError(
      'invalidFieldValue',
      '图片中没有读到岗位描述文本，请换一张更清晰的图片或直接粘贴文本。',
      { entity: 'attachment', id: attachment.id, blockers: [attachment.id] },
    )
  }
  return text
}

async function storeAndParse(
  deps: JobPostingToolDeps,
  context: ToolContext,
  input: {
    readonly rawText: string
    readonly source: string
    readonly imageAttachmentIds: readonly AttachmentId[]
  },
): Promise<AnalyzeJobDescriptionOutput | ToolFailure> {
  const posting: JobPosting = {
    id: asJobPostingId(deps.ids.next()),
    rawText: input.rawText,
    source: input.source,
    imageAttachmentIds: input.imageAttachmentIds,
    conversationId: context.conversationId,
    resumeId: null,
    parsed: null,
    parsedByRunId: null,
    parsedAt: null,
    createdAt: deps.clock.now(),
  }
  await deps.jobPostings.insert(posting)
  const outcome = await parseJobPosting(
    {
      model: deps.model,
      jobPostings: deps.jobPostings,
      runs: deps.runs,
      clock: deps.clock,
      ids: deps.ids,
    },
    { jobPostingId: posting.id },
  )
  if (!outcome.ok) return toolFailure(parseFailureToDomainError(outcome.error))
  return { jobPostingId: outcome.value.jobPosting.id, parsed: outcome.value.jobPosting.parsed }
}

function parseFailureToDomainError(failure: JobPostingParseFailure): DomainError {
  if (failure.kind === 'unknownPosting') {
    return new DomainError('invalidFieldValue', failure.detail, {
      entity: 'jobPosting',
      id: failure.jobPostingId,
      blockers: [failure.jobPostingId],
    })
  }
  return new DomainError('invalidFieldValue', failure.detail, {
    entity: 'jobPosting',
    id: '',
    blockers: ['text'],
  })
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize))
  }
  return btoa(binary)
}
