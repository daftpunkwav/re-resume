/**
 * @file deps
 * @description The dependency bundle the tool pack is constructed with. One
 * bundle, closed over by every tool at construction time, keeps the per-call
 * ToolContext to the run's own identity and the ports a single call needs.
 *
 * Constraints:
 * - Only ports, the model, the measurer, the clock and the identifier source:
 *   the bundle is assembled once by a composition root and never mutated.
 * - The tool pack never constructs infrastructure; a missing capability is a
 *   wiring error, not a fallback.
 */

import type { AttachmentRepository } from '../../../domain/conversation/ports/AttachmentRepository'
import type { FileStore } from '../../../domain/conversation/ports/FileStore'
import type { ChangeLogRepository } from '../../../domain/changes/ports/ChangeLogRepository'
import type { InfoEntryReferenceQuery } from '../../../domain/info/ports/InfoEntryReferenceQuery'
import type { CustomModuleRepository } from '../../../domain/info/ports/CustomModuleRepository'
import type { InfoEntryRepository } from '../../../domain/info/ports/InfoEntryRepository'
import type { PdfFileSaver } from '../../../domain/resume/ports/PdfFileSaver'
import type { ResumePdfExporter } from '../../../domain/resume/ports/ResumePdfExporter'
import type { ResumeRepository } from '../../../domain/resume/ports/ResumeRepository'
import type { TextMeasurer } from '../../../domain/resume/ports/TextMeasurer'
import type { AgentRunRepository } from '../../../domain/generation/ports/AgentRunRepository'
import type { JobPostingRepository } from '../../../domain/generation/ports/JobPostingRepository'
import type { ModelProvider } from '../../../domain/generation/ports/ModelProvider'
import type { Clock } from '../../../domain/shared/Clock'
import type { IdGenerator } from '../../../domain/shared/IdGenerator'
import type { PdfExportDeps } from '../../export/exportPdf'
import type { InfoLibraryDeps } from '../../info/library'
import type { ToolContext } from '../../../domain/generation/ports/ToolRegistry'
import type { ResumeContentDeps } from '../../resume/resumeSource'

export interface ToolPackDeps {
  readonly model: ModelProvider
  readonly entries: InfoEntryRepository
  readonly customModules: CustomModuleRepository
  readonly references: InfoEntryReferenceQuery
  readonly resumes: ResumeRepository
  readonly changes: ChangeLogRepository
  readonly jobPostings: JobPostingRepository
  readonly runs: AgentRunRepository
  readonly attachments: AttachmentRepository
  readonly fileStore: FileStore
  readonly measurer: TextMeasurer
  readonly clock: Clock
  readonly ids: IdGenerator
  /** The renderer the export tool calls; the root owns the font registry behind it. */
  readonly pdfExporter: ResumePdfExporter
  /** The saver that opens the system dialog; a tool never writes a file silently. */
  readonly pdfSaver: PdfFileSaver
}

/**
 * The ports the tool pack and the run loop share, named once. The run loop
 * takes this subset (`RunAgentTurnDeps` extends it) and the wiring assembles
 * one object for both, so a port added here reaches tools and turn together;
 * the tool-only render/saver pair stays out of the loop's type.
 */
export type SharedGenerationPorts = Pick<
  ToolPackDeps,
  | 'model'
  | 'entries'
  | 'customModules'
  | 'resumes'
  | 'changes'
  | 'jobPostings'
  | 'runs'
  | 'attachments'
  | 'fileStore'
  | 'measurer'
  | 'clock'
  | 'ids'
>

/**
 * The shared ports as the tool context names them. The two vocabularies differ
 * in exactly one word (entries -> infoEntries), so this is the single place the
 * mapping is written; a port the bundle grows flows through here.
 */
export function toToolContextPorts(deps: SharedGenerationPorts): Pick<
  ToolContext,
  | 'infoEntries'
  | 'customModules'
  | 'resumes'
  | 'changes'
  | 'measurer'
  | 'jobPostings'
  | 'attachments'
  | 'fileStore'
  | 'clock'
  | 'ids'
> {
  return {
    infoEntries: deps.entries,
    customModules: deps.customModules,
    resumes: deps.resumes,
    changes: deps.changes,
    measurer: deps.measurer,
    jobPostings: deps.jobPostings,
    attachments: deps.attachments,
    fileStore: deps.fileStore,
    clock: deps.clock,
    ids: deps.ids,
  }
}

/** The dependency record the library use cases take. */
export function infoLibraryDeps(deps: ToolPackDeps): InfoLibraryDeps {
  return {
    entries: deps.entries,
    customModules: deps.customModules,
    references: deps.references,
    clock: deps.clock,
    ids: deps.ids,
  }
}

/** The dependency record the resume content queries take. */
export function resumeContentDeps(deps: ToolPackDeps): ResumeContentDeps {
  return {
    resumes: deps.resumes,
    entries: deps.entries,
    customModules: deps.customModules,
    measurer: deps.measurer,
  }
}

/** The dependency record the PDF export use cases take. */
export function pdfExportDeps(deps: ToolPackDeps): PdfExportDeps {
  return {
    ...resumeContentDeps(deps),
    exporter: deps.pdfExporter,
    saver: deps.pdfSaver,
    attachments: deps.attachments,
    fileStore: deps.fileStore,
  }
}
