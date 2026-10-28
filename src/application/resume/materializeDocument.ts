/**
 * @file materializeDocument
 * @description The single content exit of the resume model: it turns a document
 * state plus the library values it references into styled layout blocks. The
 * canvas, the layout engine, the PDF exporter and the agent's layout check all
 * read this output, so no caller ever assembles resume text of its own.
 *
 * Responsibilities:
 * - Resolve template tokens and appearance into the seven text styles
 * - Build the header block, the summary override and one block per section and
 *   entry, replacing bodies with entry overrides
 * - Map every information module's fields to heading/meta/body paragraphs
 * - Mark two-column placements when the template is a sidebar template
 * - Report missing references and truncate defensively long content
 * - Lay the produced blocks out for the callers that need geometry (the input
 *   carries the measurer for exactly that step)
 *
 * Constraints:
 * - Pure: no I/O, no clock, no identifier source. Block ids come from document
 *   ids, so two materializations of one state produce the same ids.
 * - A missing reference never throws: it becomes a placeholder and an entry in
 *   `missingReferences`.
 * - Content semantics stop here; `layout()` only sees paragraphs and placement.
 */

import type { CanvasBlock } from '../../domain/resume/CanvasLayout'
import type { CustomModuleDefinition } from '../../domain/info/CustomModule'
import type { InfoEntry } from '../../domain/info/InfoEntry'
import type { InfoFieldValue } from '../../domain/info/InfoFieldValue'
import { MODULE_FIELDS } from '../../domain/info/InfoFieldValue'
import type { InfoModuleKind } from '../../domain/info/InfoModuleKind'
import {
  formatKnowledgeDate,
  parseKnowledgeDate,
} from '../../domain/shared/KnowledgeDate'
import type { LayoutBlock, StyledParagraph } from '../../domain/resume/Layout'
import type { LayoutOutput } from '../../domain/resume/PageLayout'
import type { MissingReference } from '../../domain/resume/MissingReference'
import type { Resume } from '../../domain/resume/Resume'
import type { MaterializedDocument, MaterializedWarning } from '../../domain/resume/ResumeSnapshot'
import type { ResumeOverride } from '../../domain/resume/ResumeOverride'
import type { ResumeSection } from '../../domain/resume/ResumeSection'
import { sectionDisplayName } from '../../domain/resume/ResumeSection'
import type { AppearanceSettings } from '../../domain/resume/AppearanceSettings'
import { fontPairFamily } from '../../domain/resume/AppearanceSettings'
import type { TextStyle } from '../../domain/resume/TextStyle'
import type { TemplateDefinition, TemplateTokens } from '../../domain/resume/Template'
import { SIDEBAR_MODULE_KINDS } from '../../domain/resume/Template'
import type { InfoEntryId, LayoutBlockId, ResumeSectionId } from '../../domain/shared/branded-id'
import { asLayoutBlockId } from '../../domain/shared/branded-id'
import { countCodePoints } from '../../domain/info/codePoints'
import type { TextMeasurer } from '../../domain/resume/ports/TextMeasurer'
import { layout } from '../layout/layout'

/** Deterministic id of the header block a personal entry produces. */
export const HEADER_BLOCK_ID: LayoutBlockId = asLayoutBlockId('header')

/** Deterministic id of the block a summary override produces. */
export const SUMMARY_BLOCK_ID: LayoutBlockId = asLayoutBlockId('summary')

/** Paragraphs a block may carry before the rest is dropped as `text-truncated`. */
export const MAX_BLOCK_PARAGRAPHS = 200

/** Code points a single paragraph may carry before it is truncated. */
export const MAX_PARAGRAPH_CODE_POINTS = 8000

/** The seven text styles a template and appearance resolve to. */
export interface ResolvedStyles {
  readonly name: TextStyle
  readonly contact: TextStyle
  readonly sectionHeader: TextStyle
  readonly entryHeading: TextStyle
  readonly entryMeta: TextStyle
  readonly entryBody: TextStyle
  readonly freeText: TextStyle
}

export interface MaterializeInput {
  readonly resume: Resume
  readonly entries: ReadonlyMap<string, InfoEntry>
  readonly customModules: ReadonlyMap<string, CustomModuleDefinition>
  readonly template: TemplateDefinition
  /**
   * The measurer the caller lays the blocks out with. It is part of this input
   * because the query that reports page counts and the geometry step share one
   * dependency record; `materializeDocument` itself only resolves text.
   */
  readonly measurer: TextMeasurer
}

/**
 * Scales one token to the appearance: `fontSize` is multiplied by `fontScale`
 * and rounded to half a point, with 8pt as the floor; line height, family and
 * weight come from the appearance and the token.
 */
export function resolveStyles(
  tokens: TemplateTokens,
  appearance: AppearanceSettings,
): ResolvedStyles {
  const family = fontPairFamily(appearance.fontPairId)
  const style = (token: TemplateTokens['name']): TextStyle => ({
    fontFamily: family,
    fontSize: Math.max(8, Math.round(token.fontSize * appearance.fontScale * 2) / 2),
    fontWeight: token.fontWeight,
    lineHeight: appearance.lineHeight,
  })
  return {
    name: style(tokens.name),
    contact: style(tokens.contact),
    sectionHeader: style(tokens.sectionHeader),
    entryHeading: style(tokens.entryHeading),
    entryMeta: style(tokens.entryMeta),
    entryBody: style(tokens.entryBody),
    freeText: style(tokens.freeText),
  }
}

/**
 * Lays the produced blocks out with the page, measurer and column values the
 * same input names. Kept next to the materializer so the two steps that define
 * the rendered document share one dependency record.
 */
export function layoutMaterializedDocument(
  input: MaterializeInput,
  blocks: readonly LayoutBlock[],
): LayoutOutput {
  return layout({
    blocks,
    page: input.resume.document.pageSetup,
    measurer: input.measurer,
    columnRatio: input.template.tokens.columnRatio,
    columnGutter: input.template.tokens.columnGutter,
  })
}

/** Materializes the document into the content every renderer draws. */
export function materializeDocument(input: MaterializeInput): MaterializedDocument {
  return new DocumentBuilder(input).build()
}

/**
 * The mapping state. A class rather than a pile of parameters: the builder keeps
 * the accumulated warnings and missing references while each section adds its
 * blocks, and the accumulation order is the document order.
 */
class DocumentBuilder {
  readonly #input: MaterializeInput
  readonly #styles: ResolvedStyles
  readonly #warnings: MaterializedWarning[] = []
  readonly #missing: MissingReference[] = []
  readonly #sidebarMode: boolean
  readonly #entryOverrides: ReadonlyMap<string, ResumeOverride>

  constructor(input: MaterializeInput) {
    this.#input = input
    this.#styles = resolveStyles(input.template.tokens, input.resume.document.appearance)
    this.#sidebarMode =
      input.template.tokens.sidebarMode && input.resume.document.pageSetup.columns === 2
    this.#entryOverrides = new Map(
      input.resume.document.overrides.flatMap((override) =>
        override.target.kind === 'entry'
          ? [[override.target.entryId, override] as const]
          : [],
      ),
    )
  }

  build(): MaterializedDocument {
    const { resume, template } = this.#input
    if (template.id !== resume.document.templateId) {
      this.#missing.push({ kind: 'template', templateId: resume.document.templateId })
    }
    this.#reportMissingOverrides()

    const sections = orderedSections(resume.document.sections)
    const header = this.#headerBlock(sections)
    const summary = this.#summaryBlock()
    const { sidebar, main } = this.#sectionBlocks(sections)

    const leading = header === null ? [] : [header]
    const blocks = this.#sidebarMode
      ? [...leading, ...sidebar, ...summary, ...main]
      : [...leading, ...summary, ...sidebar, ...main]
    const canvasBlocks = [...resume.document.canvas.freeBlocks]
      .sort((left, right) => left.zIndex - right.zIndex)
      .map((block) => this.#freeBlock(block))

    return {
      blocks: [...blocks, ...canvasBlocks].map((block) => this.#truncate(block)),
      missingReferences: this.#missing,
      warnings: this.#warnings,
    }
  }

  /**
   * The header shows the first selectable personal entry. A personal section
   * that references a deleted entry renders a placeholder, so the missing
   * reference stays visible instead of silently disappearing.
   */
  #headerBlock(sections: readonly ResumeSection[]): LayoutBlock | null {
    const personal = sections.find(
      (section) => section.moduleKind === 'personal' && section.visible,
    )
    if (personal === undefined) return null
    const entryId = personal.entryIds[0]
    if (entryId === undefined) return null
    const entry = this.#input.entries.get(entryId)
    if (entry === undefined) {
      this.#reportMissingEntry(entryId, personal.id)
      return this.#placeholderBlock(HEADER_BLOCK_ID, personal)
    }
    return {
      id: HEADER_BLOCK_ID,
      role: 'entry',
      paragraphs: this.#headerParagraphs(entry),
      placement: this.#flowPlacement(personal),
      keepWithNext: false,
      keepTogether: true,
      image: null,
    }
  }

  #headerParagraphs(entry: InfoEntry): readonly StyledParagraph[] {
    const { fields } = entry
    const paragraphSpacing = this.#input.template.tokens.paragraphSpacing
    const paragraphs: StyledParagraph[] = [
      {
        text: textOf(fields.fullName) || entry.title,
        style: this.#styles.name,
        bullet: false,
        spaceBefore: 0,
      },
    ]
    const contact = joinParts([
      textOf(fields.phone),
      textOf(fields.email),
      textOf(fields.city),
      textOf(fields.wechat),
    ])
    if (contact !== '') {
      paragraphs.push({
        text: contact,
        style: this.#styles.contact,
        bullet: false,
        spaceBefore: paragraphSpacing,
      })
    }
    const links = joinParts([textOf(fields.website), textOf(fields.github)])
    if (links !== '') {
      paragraphs.push({
        text: links,
        style: this.#styles.contact,
        bullet: false,
        spaceBefore: paragraphSpacing,
      })
    }
    const override = this.#entryOverrides.get(entry.id)
    if (override !== undefined) {
      paragraphs.push({
        text: override.text,
        style: this.#styles.entryBody,
        bullet: false,
        spaceBefore: paragraphSpacing,
      })
    }
    return paragraphs
  }

  /** The summary override sits between the header and the first section. */
  #summaryBlock(): readonly LayoutBlock[] {
    const summary = this.#input.resume.document.overrides.find(
      (override) => override.target.kind === 'summary',
    )
    if (summary === undefined) return []
    return [
      {
        id: SUMMARY_BLOCK_ID,
        role: 'entry',
        paragraphs: [
          {
            text: summary.text,
            style: this.#styles.entryBody,
            bullet: false,
            spaceBefore: this.#input.template.tokens.sectionSpacing,
          },
        ],
        placement: this.#sidebarMode
          ? { mode: 'flow', columnSpan: 1, column: 2 }
          : { mode: 'flow', columnSpan: 1, column: 'auto' },
        keepWithNext: false,
        keepTogether: false,
        image: null,
      },
    ]
  }

  /**
   * Section blocks split into the sidebar group and the body group. A sidebar
   * template fills its first column with the first group before the body column
   * starts; every other template emits one group in document order.
   */
  #sectionBlocks(sections: readonly ResumeSection[]): {
    readonly sidebar: readonly LayoutBlock[]
    readonly main: readonly LayoutBlock[]
  } {
    const renderable = sections.filter(
      (section) => section.visible && section.moduleKind !== 'personal',
    )
    if (!this.#sidebarMode) {
      return { sidebar: [], main: renderable.flatMap((section) => this.#sectionOf(section)) }
    }
    return {
      sidebar: renderable
        .filter((section) => SIDEBAR_MODULE_KINDS.has(section.moduleKind))
        .flatMap((section) => this.#sectionOf(section)),
      main: renderable
        .filter((section) => !SIDEBAR_MODULE_KINDS.has(section.moduleKind))
        .flatMap((section) => this.#sectionOf(section)),
    }
  }

  #sectionOf(section: ResumeSection): readonly LayoutBlock[] {
    const customModule =
      section.customModuleId === null
        ? null
        : this.#input.customModules.get(section.customModuleId) ?? null
    if (section.moduleKind === 'custom' && customModule === null) {
      if (section.customModuleId !== null) {
        this.#missing.push({
          kind: 'customModule',
          moduleId: section.customModuleId,
          sectionId: section.id,
        })
      }
      return [
        this.#sectionHeaderBlock(section, '模块已删除'),
        this.#placeholderBlock(this.#missingSectionId(section), section),
      ]
    }
    const header = this.#sectionHeaderBlock(
      section,
      sectionDisplayName(section, customModule),
    )
    const entries = section.entryIds.flatMap((entryId) => {
      const entry = this.#input.entries.get(entryId)
      if (entry === undefined) {
        this.#reportMissingEntry(entryId, section.id)
        return [this.#placeholderBlock(entryBlockId(entryId), section)]
      }
      return [this.#entryBlock(entry, section, customModule)]
    })
    return [header, ...entries]
  }

  #sectionHeaderBlock(section: ResumeSection, title: string): LayoutBlock {
    return {
      id: sectionBlockId(section.id),
      role: 'sectionHeader',
      paragraphs: [
        {
          text: title,
          style: this.#styles.sectionHeader,
          bullet: false,
          spaceBefore: this.#input.template.tokens.sectionSpacing,
        },
      ],
      placement: this.#flowPlacement(section),
      keepWithNext: true,
      keepTogether: false,
      image: null,
    }
  }

  #placeholderBlock(id: LayoutBlockId, section: ResumeSection): LayoutBlock {
    return {
      id,
      role: 'freeText',
      paragraphs: [
        {
          text: '【缺失条目】',
          style: this.#styles.freeText,
          bullet: false,
          spaceBefore: 0,
        },
      ],
      placement: this.#flowPlacement(section),
      keepWithNext: false,
      keepTogether: false,
      image: null,
    }
  }

  #entryBlock(
    entry: InfoEntry,
    section: ResumeSection,
    customModule: CustomModuleDefinition | null,
  ): LayoutBlock {
    return {
      id: entryBlockId(entry.id),
      role: 'entry',
      paragraphs: this.#entryParagraphs(entry, customModule),
      placement: this.#flowPlacement(section),
      keepWithNext: false,
      keepTogether: true,
      image: null,
    }
  }

  #entryParagraphs(
    entry: InfoEntry,
    customModule: CustomModuleDefinition | null,
  ): readonly StyledParagraph[] {
    const mapped = mapEntryContent(entry, customModule)
    const override = this.#entryOverrides.get(entry.id)
    const tokens = this.#input.template.tokens
    const paragraphs: StyledParagraph[] = []
    let spaceBefore = tokens.entrySpacing
    if (mapped.heading !== '') {
      paragraphs.push({
        text: mapped.heading,
        style: this.#styles.entryHeading,
        bullet: false,
        spaceBefore,
      })
      spaceBefore = tokens.paragraphSpacing
    }
    if (mapped.meta !== '') {
      paragraphs.push({
        text: mapped.meta,
        style: this.#styles.entryMeta,
        bullet: false,
        spaceBefore,
      })
      spaceBefore = tokens.paragraphSpacing
    }
    const body = override === undefined ? mapped.body : [{ text: override.text, bullet: false }]
    for (const paragraph of body) {
      paragraphs.push({
        text: paragraph.text,
        style: this.#styles.entryBody,
        bullet: paragraph.bullet,
        spaceBefore,
      })
      spaceBefore = tokens.paragraphSpacing
    }
    return paragraphs
  }

  #freeBlock(block: CanvasBlock): LayoutBlock {
    const placement = {
      mode: 'absolute' as const,
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      pageIndex: block.pageIndex,
    }
    if (block.kind === 'image') {
      if (block.attachmentId === null) {
        this.#addWarning('image-missing')
        return {
          id: freeBlockId(block.id),
          role: 'image',
          paragraphs: [],
          placement,
          keepWithNext: false,
          keepTogether: false,
          image: null,
        }
      }
      return {
        id: freeBlockId(block.id),
        role: 'image',
        paragraphs: [],
        placement,
        keepWithNext: false,
        keepTogether: false,
        image: { attachmentId: block.attachmentId, width: block.width, height: block.height },
      }
    }
    if (block.kind === 'divider') {
      return {
        id: freeBlockId(block.id),
        role: 'divider',
        paragraphs: [],
        placement,
        keepWithNext: false,
        keepTogether: false,
        image: null,
      }
    }
    const style = block.textStyle ?? this.#styles.freeText
    return {
      id: freeBlockId(block.id),
      role: 'freeText',
      paragraphs: paragraphLines(block.text ?? '', style, 0),
      placement,
      keepWithNext: false,
      keepTogether: false,
      image: null,
    }
  }

  #flowPlacement(section: ResumeSection): LayoutBlock['placement'] {
    if (!this.#sidebarMode) return { mode: 'flow', columnSpan: 1, column: 'auto' }
    const column = SIDEBAR_MODULE_KINDS.has(section.moduleKind) ? 1 : 2
    return { mode: 'flow', columnSpan: 1, column }
  }

  #reportMissingEntry(entryId: InfoEntryId, sectionId: ResumeSectionId): void {
    this.#missing.push({ kind: 'entry', entryId, sectionId })
    this.#addWarning('entry-missing')
  }

  /**
   * An override whose entry no longer exists is not rendered; it is reported so
   * the interface can offer to clean it up, and it stays in the state so the
   * text returns if the entry does.
   */
  #reportMissingOverrides(): void {
    for (const override of this.#input.resume.document.overrides) {
      if (override.target.kind !== 'entry') continue
      if (this.#input.entries.has(override.target.entryId)) continue
      this.#missing.push({
        kind: 'override',
        overrideId: override.id,
        entryId: override.target.entryId,
      })
    }
  }

  #addWarning(warning: MaterializedWarning): void {
    if (!this.#warnings.includes(warning)) this.#warnings.push(warning)
  }

  /** Enforces the block and paragraph caps, reporting what was cut. */
  #truncate(block: LayoutBlock): LayoutBlock {
    let truncated = block.paragraphs.length > MAX_BLOCK_PARAGRAPHS
    const paragraphs = block.paragraphs.slice(0, MAX_BLOCK_PARAGRAPHS).map((paragraph) => {
      if (countCodePoints(paragraph.text) <= MAX_PARAGRAPH_CODE_POINTS) return paragraph
      truncated = true
      return {
        ...paragraph,
        text: [...paragraph.text].slice(0, MAX_PARAGRAPH_CODE_POINTS).join(''),
      }
    })
    if (!truncated) return block
    this.#addWarning('text-truncated')
    return { ...block, paragraphs }
  }

  #missingSectionId(section: ResumeSection): LayoutBlockId {
    return asLayoutBlockId(`missing:${section.id}`)
  }
}

function sectionBlockId(sectionId: string): LayoutBlockId {
  return asLayoutBlockId(`section:${sectionId}`)
}

function entryBlockId(entryId: string): LayoutBlockId {
  return asLayoutBlockId(`entry:${entryId}`)
}

function freeBlockId(blockId: string): LayoutBlockId {
  return asLayoutBlockId(`free:${blockId}`)
}

/** Sections in render order; the array is already dense, sorting makes it explicit. */
function orderedSections(sections: readonly ResumeSection[]): readonly ResumeSection[] {
  return [...sections].sort((left, right) => left.sortOrder - right.sortOrder)
}

interface MappedEntryContent {
  readonly heading: string
  readonly meta: string
  readonly body: readonly { readonly text: string; readonly bullet: boolean }[]
}

/** The field mapping table of spec section 11.2, one module at a time. */
function mapEntryContent(
  entry: InfoEntry,
  customModule: CustomModuleDefinition | null,
): MappedEntryContent {
  const { fields } = entry
  const period = periodText(textOf(fields.startDate), textOf(fields.endDate))
  switch (entry.moduleKind) {
    case 'personal':
      // A personal entry other than the header one still maps to its identity.
      return {
        heading: textOf(fields.fullName) || entry.title,
        meta: joinParts([textOf(fields.phone), textOf(fields.email)]),
        body: [],
      }
    case 'education': {
      const degree = optionLabel('education', 'degree', textOf(fields.degree))
      return {
        heading: joinParenthesized(textOf(fields.school), degree),
        meta: joinParts([period, textOf(fields.major)]),
        body: bulletLines(textOf(fields.courses)).concat(
          bulletLines(textOf(fields.description)),
        ),
      }
    }
    case 'internship': {
      const responsibilities = bulletLines(textOf(fields.responsibilities))
      const achievements = textOf(fields.achievements)
      return {
        heading: joinParts([textOf(fields.company), textOf(fields.role)]),
        meta: joinParts([period, textOf(fields.department), textOf(fields.location)]),
        body:
          achievements === ''
            ? responsibilities
            : [...responsibilities, { text: `成果：${achievements}`, bullet: true }],
      }
    }
    case 'project': {
      const body: { text: string; bullet: boolean }[] = []
      appendParagraph(body, textOf(fields.description))
      appendParagraph(body, textOf(fields.responsibilities))
      appendParagraph(body, textOf(fields.achievements))
      appendParagraph(body, textOf(fields.link))
      return {
        heading: joinParenthesized(textOf(fields.name), textOf(fields.role)),
        meta: joinParts([period, textOf(fields.techStack)]),
        body,
      }
    }
    case 'skill': {
      const level = optionLabel('skill', 'level', textOf(fields.level))
      return {
        heading: joinParts([
          joinParenthesized(textOf(fields.name), textOf(fields.category)),
          level,
        ]),
        meta: '',
        body: [],
      }
    }
    case 'award': {
      const level = optionLabel('award', 'level', textOf(fields.level))
      return {
        heading: joinParenthesized(textOf(fields.name), level),
        meta: formatIfDate(textOf(fields.date)),
        body: plainLines(textOf(fields.description)),
      }
    }
    case 'jobIntent':
      return {
        heading: joinParts([
          textOf(fields.targetRole),
          textOf(fields.city),
          textOf(fields.salaryRange),
          optionLabel('jobIntent', 'employmentType', textOf(fields.employmentType)),
        ]),
        meta: formatIfDate(textOf(fields.availableFrom)),
        body: plainLines(textOf(fields.notes)),
      }
    case 'selfEvaluation':
      return {
        heading: entry.title,
        meta: '',
        body: plainLines(textOf(fields.content)),
      }
    case 'custom':
      return {
        heading: entry.title,
        meta: '',
        body: customFieldLines(entry, customModule),
      }
  }
}

/** A custom entry renders every declared non-empty field as `label：value`. */
function customFieldLines(
  entry: InfoEntry,
  customModule: CustomModuleDefinition | null,
): readonly { readonly text: string; readonly bullet: boolean }[] {
  if (customModule === null) return []
  const lines: { text: string; bullet: boolean }[] = []
  for (const field of customModule.fields) {
    const value = textOf(entry.fields[field.key])
    if (value === '') continue
    lines.push({ text: `${field.label}：${value}`, bullet: false })
  }
  return lines
}

function appendParagraph(target: { text: string; bullet: boolean }[], text: string): void {
  if (text !== '') target.push({ text, bullet: false })
}

/** A textarea value is bulleted line by line (spec section 11.2). */
function bulletLines(text: string): readonly { readonly text: string; readonly bullet: boolean }[] {
  return splitLines(text).map((line) => ({ text: line, bullet: true }))
}

function plainLines(text: string): readonly { readonly text: string; readonly bullet: boolean }[] {
  return splitLines(text).map((line) => ({ text: line, bullet: false }))
}

/** One styled paragraph per source line; empty lines are not content. */
function paragraphLines(
  text: string,
  style: TextStyle,
  spaceBefore: number,
): readonly StyledParagraph[] {
  return splitLines(text).map((line) => ({ text: line, style, bullet: false, spaceBefore }))
}

function splitLines(text: string): readonly string[] {
  return text
    .split(/\r\n|\r|\n/u)
    .map((line) => line.trim())
    .filter((line) => line !== '')
}

function textOf(value: InfoFieldValue | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

function joinParts(parts: readonly string[]): string {
  return parts.filter((part) => part !== '').join(' · ')
}

/** `name（detail）` with the detail omitted when blank. */
function joinParenthesized(name: string, detail: string): string {
  if (detail === '') return name
  return `${name}（${detail}）`
}

/** The enum label of a built-in field, read from the one field table. */
function optionLabel(
  moduleKind: Exclude<InfoModuleKind, 'custom'>,
  fieldKey: string,
  value: string,
): string {
  if (value === '') return ''
  const descriptor = MODULE_FIELDS[moduleKind].find((field) => field.key === fieldKey)
  return descriptor?.options?.find((option) => option.value === value)?.label ?? value
}

/** A stored knowledge date rendered for display, or '' when absent. */
function formatIfDate(value: string): string {
  if (value === '') return ''
  const parsed = parseKnowledgeDate(value)
  return parsed === null ? value : formatKnowledgeDate(parsed)
}

function periodText(start: string, end: string): string {
  const startText = formatIfDate(start)
  const endText = formatIfDate(end)
  if (startText !== '' && endText !== '') return `${startText} - ${endText}`
  return startText !== '' ? startText : endText
}
