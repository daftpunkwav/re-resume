/**
 * @file buildPdfDocument
 * @description Maps a laid-out resume to the PDF renderer's document tree. The
 * mapping is purely geometric: every line lands where `layout()` placed it, and
 * the renderer is never allowed to re-wrap or re-paginate. Decorations the
 * template and appearance define (header rule, section-heading treatment, page
 * numbers, split header) are drawn from the same tokens the materializer
 * received, so the file and the canvas share one truth.
 *
 * Responsibilities:
 * - Emit one page per laid-out page (at least one, so a valid PDF exists)
 * - Draw each block's precomputed lines at their coordinates, run by run, with
 *   the face each run was measured with
 * - Render web URLs in the header as PDF link annotations
 * - Draw dividers, images and the missing-image placeholder
 * - Draw the template's header rule, the section-heading treatment the
 *   appearance selects, the page number and the repeated header name
 *
 * Constraints:
 * - Lines are absolutely positioned with wrapping disabled; a renderer-side
 *   line break would move content the pagination never placed there.
 * - Only web URLs become annotations: a `file:` or custom-scheme URL stays
 *   text, because a link annotation invites a reader's viewer to launch a local
 *   handler.
 * - Run baseline shifts are not expressible here; they belong to the residual
 *   cross-engine drawing differences the spec tracks as an open item.
 */

import type { ReactElement, ReactNode } from 'react'
import { Document, Image, Link, Page, Text, View } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'

import type { AppearanceSettings } from '../../../domain/resume/AppearanceSettings'
import type { LayoutBlock } from '../../../domain/resume/Layout'
import type { LaidOutBlock } from '../../../domain/resume/PageLayout'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import { contentWidth, pageHeight, pageWidth } from '../../../domain/resume/PageSetup'
import type { TemplateDefinition } from '../../../domain/resume/Template'
import { DEFAULT_FONT_FAMILY } from '../../../domain/resume/TextStyle'
import type { PdfExportInput } from '../../../domain/resume/ports/ResumePdfExporter'
import type { TextRun } from '../../../domain/resume/ports/TextMeasurer'
import {
  ACCENT_BAR_OFFSET,
  ACCENT_BAR_WIDTH,
  INK,
  MISSING_IMAGE_BORDER,
  MISSING_IMAGE_LABEL,
  MUTED,
  RULE_THICKNESS,
  decorationColor,
  pdfAccentColor,
} from './pdfTheme'

/**
 * Block id the materializer gives the header block. Repeated rather than
 * imported because infrastructure may not import the application layer; the id
 * is part of the materialized output the exporter consumes.
 */
const HEADER_BLOCK_ID = 'header'

const PAGE_NUMBER_FONT_SIZE = 9
const HEADER_NAME_FONT_SIZE = 10
const BOXED_HEADING_PADDING = 4
const BOXED_HEADING_BORDER_WIDTH = 0.75

export function buildPdfDocument(input: PdfExportInput): ReactElement<DocumentProps> {
  const sourceById = new Map(input.blocks.map((block) => [block.id, block] as const))
  const accent = pdfAccentColor(input.appearance, input.template)
  // An empty document still exports: a zero-page PDF is not a file any viewer
  // accepts, so it becomes one blank page.
  const pageCount = Math.max(1, input.laidOut.pages.length)
  const width = pageWidth(input.page)
  const height = pageHeight(input.page)
  return (
    <Document>
      {Array.from({ length: pageCount }, (_, pageIndex) => {
        const blocks = input.laidOut.blocks.filter((block) => block.pageIndex === pageIndex)
        return (
          <Page key={pageIndex} size={[width, height]} style={{ padding: 0 }}>
            {blocks.map((block) => {
              const source = sourceById.get(block.blockId)
              if (source === undefined) return null
              return (
                <BlockView
                  key={block.blockId}
                  laidOut={block}
                  source={source}
                  page={input.page}
                  template={input.template}
                  accent={accent}
                  images={input.images}
                />
              )
            })}
            <PageDecorations
              page={input.page}
              template={input.template}
              appearance={input.appearance}
              accent={accent}
              headerName={input.headerName}
              pageIndex={pageIndex}
              pageCount={pageCount}
              blocks={blocks}
              sourceById={sourceById}
            />
          </Page>
        )
      })}
    </Document>
  )
}

interface BlockViewProps {
  readonly laidOut: LaidOutBlock
  readonly source: LayoutBlock
  readonly page: PageSetup
  readonly template: TemplateDefinition
  readonly accent: string | null
  readonly images: ReadonlyMap<string, string>
}

function BlockView(props: BlockViewProps): ReactNode {
  const { laidOut, source, page, template, accent, images } = props
  const left = page.marginLeft + laidOut.x
  const top = page.marginTop + laidOut.y
  if (source.role === 'divider') {
    return (
      <View
        style={{
          position: 'absolute',
          top,
          left,
          width: laidOut.width,
          height: RULE_THICKNESS,
          backgroundColor: INK,
        }}
      />
    )
  }
  if (source.role === 'image' || laidOut.image !== null) {
    const src =
      laidOut.image === null ? undefined : images.get(laidOut.image.attachmentId)
    if (src === undefined) {
      return <MissingImageBox top={top} left={left} width={laidOut.width} height={laidOut.height} />
    }
    return (
      <Image
        src={src}
        style={{
          position: 'absolute',
          top,
          left,
          width: laidOut.width,
          height: laidOut.height,
          objectFit: 'contain',
        }}
      />
    )
  }
  return (
    <>
      {renderLines(laidOut, source, page, template, accent)}
    </>
  )
}

/**
 * Draws the block's lines with the per-line geometry the layout decided.
 *
 * Header links are recognised by type size: the materializer draws the contact
 * and link lines with the template's smallest header style, while an entry
 * override appended to the header uses the body style. That keeps a web style
 * URL in override text as plain text, which is the v1 rule for text the user
 * wrote. A header with no contact line at all (only the name and, possibly, an
 * override) is ambiguous, so it is left unlinked rather than guessing.
 */
function renderLines(
  laidOut: LaidOutBlock,
  source: LayoutBlock,
  page: PageSetup,
  template: TemplateDefinition,
  accent: string | null,
): ReactNode {
  const header = isCenteredHeader(laidOut, template)
  const linkColor = decorationColor(accent)
  const contactFontSize = linkLineFontSize(source, laidOut)
  let offset = source.paragraphs[0]?.spaceBefore ?? 0
  return laidOut.lines.map((line, index) => {
    const lineTop = page.marginTop + laidOut.y + offset
    offset += line.style.fontSize * line.style.lineHeight
    const lineLeft = header
      ? page.marginLeft + (contentWidth(page) - line.width) / 2
      : page.marginLeft + laidOut.x + line.x
    const linkable = contactFontSize !== null && line.style.fontSize === contactFontSize
    return (
      <Text
        key={index}
        wrap={false}
        style={{
          position: 'absolute',
          top: lineTop,
          left: lineLeft,
          // wrap={false} only stops page wrapping, not line breaking: an
          // absolutely positioned element breaks against the space between its
          // left edge and the page edge, and a line near the right margin would
          // get re-broken there. The box is the width the measurer decided the
          // line fits in, so breaking is never triggered.
          width: Math.max(line.width, 1),
          fontFamily: line.style.fontFamily,
          fontSize: line.style.fontSize,
          fontWeight: line.style.fontWeight,
          lineHeight: line.style.lineHeight,
          color: INK,
        }}
      >
        {line.runs.flatMap((run, runIndex) =>
          runSegments(run, linkable, linkColor, `${index}-${runIndex}`),
        )}
      </Text>
    )
  })
}

/**
 * The font size of the header's contact/link lines, or null when the header
 * cannot be read unambiguously. The name is the first paragraph; every further
 * paragraph before an entry override is contact or link text, and those use the
 * header's smallest style. A header with a single non-name paragraph is either
 * a contact line or an override and cannot be told apart here, so it is left
 * unlinked rather than guessing.
 */
function linkLineFontSize(source: LayoutBlock, laidOut: LaidOutBlock): number | null {
  if (laidOut.blockId !== HEADER_BLOCK_ID) return null
  const rest = source.paragraphs.slice(1)
  if (rest.length < 2) return null
  return Math.min(...rest.map((paragraph) => paragraph.style.fontSize))
}

/** A centred header centres every one of its lines inside the content box. */
function isCenteredHeader(laidOut: LaidOutBlock, template: TemplateDefinition): boolean {
  return laidOut.blockId === HEADER_BLOCK_ID && template.tokens.headerLayout === 'centered'
}

/**
 * One run as inline children of its line: a plain span, or the stretches around
 * an embedded web URL with the URL itself linked. The segments are flat
 * elements, not wrapped in a fragment — the renderer's text pass does not look
 * inside fragments, and content behind one silently disappears.
 */
function runSegments(
  run: TextRun,
  linkable: boolean,
  linkColor: string,
  key: string,
): ReactElement[] {
  const style = {
    fontFamily: run.fontFamily,
    fontWeight: run.fontWeight,
  }
  if (!linkable) {
    return [<Text key={`${key}-plain`} style={style}>{run.text}</Text>]
  }
  const match = firstWebUrlIn(run.text)
  if (match === null) {
    return [<Text key={`${key}-plain`} style={style}>{run.text}</Text>]
  }
  const segments: ReactElement[] = []
  if (match.before !== '') {
    segments.push(<Text key={`${key}-before`} style={style}>{match.before}</Text>)
  }
  // The link draws its URL inline where the run placed it, underlined in the
  // template's accent (or ink where the template ignores the accent).
  segments.push(
    <Link key={`${key}-link`} src={match.url}>
      <Text style={{ ...style, color: linkColor, textDecoration: 'underline' }}>
        {match.url}
      </Text>
    </Link>,
  )
  if (match.after !== '') {
    segments.push(...runSegments({ ...run, text: match.after }, true, linkColor, `${key}-after`))
  }
  return segments
}

const WEB_URL_PATTERN = /https?:\/\/[^\s]+/u
const TRAILING_URL_PUNCTUATION = /[.,;:!?)]+$/u

function firstWebUrlIn(
  text: string,
): { readonly url: string; readonly before: string; readonly after: string } | null {
  const match = WEB_URL_PATTERN.exec(text)
  if (match === null) return null
  const raw = match[0]
  const url = raw.replace(TRAILING_URL_PUNCTUATION, '')
  if (!url.startsWith('https://') && !url.startsWith('http://')) return null
  const start = match.index
  return {
    url,
    before: text.slice(0, start),
    after: text.slice(start + url.length),
  }
}

function MissingImageBox(props: {
  readonly top: number
  readonly left: number
  readonly width: number
  readonly height: number
}): ReactNode {
  return (
    <View
      style={{
        position: 'absolute',
        top: props.top,
        left: props.left,
        width: props.width,
        height: props.height,
        borderWidth: 1,
        borderStyle: 'dashed',
        borderColor: MISSING_IMAGE_BORDER,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      <Text style={{ fontFamily: DEFAULT_FONT_FAMILY, fontSize: 8, color: MUTED }}>
        {MISSING_IMAGE_LABEL}
      </Text>
    </View>
  )
}

interface PageDecorationsProps {
  readonly page: PageSetup
  readonly template: TemplateDefinition
  readonly appearance: AppearanceSettings
  readonly accent: string | null
  readonly headerName: string | null
  readonly pageIndex: number
  readonly pageCount: number
  readonly blocks: readonly LaidOutBlock[]
  readonly sourceById: ReadonlyMap<string, LayoutBlock>
}

/**
 * Draws the template's page-level decorations after the content, so no line is
 * hidden behind a rule. Every position is derived from the page setup and the
 * laid-out header, never from re-measured content.
 */
function PageDecorations(props: PageDecorationsProps): ReactNode {
  const { page, template, appearance, accent, headerName, pageIndex, pageCount } = props
  const decorations: ReactElement[] = []
  const header = props.blocks.find((block) => block.blockId === HEADER_BLOCK_ID)
  if (template.tokens.ruleAfterHeader && header !== undefined) {
    decorations.push(
      <View
        key="header-rule"
        style={{
          position: 'absolute',
          top: page.marginTop + header.y + header.height,
          left: page.marginLeft,
          width: contentWidth(page),
          height: RULE_THICKNESS,
          backgroundColor: INK,
        }}
      />,
    )
  }
  for (const block of props.blocks) {
    const source = props.sourceById.get(block.blockId)
    if (source === undefined) continue
    const decoration = sectionHeaderDecoration(block, source, page, appearance, accent)
    if (decoration !== null) decorations.push(decoration)
  }
  if (page.showPageNumber) {
    decorations.push(
      <Text
        key="page-number"
        style={{
          position: 'absolute',
          top: pageHeight(page) - page.marginBottom / 2 - PAGE_NUMBER_FONT_SIZE / 2,
          left: page.marginLeft,
          width: contentWidth(page),
          textAlign: 'center',
          fontFamily: DEFAULT_FONT_FAMILY,
          fontSize: PAGE_NUMBER_FONT_SIZE,
          color: MUTED,
        }}
      >
        {`第 ${String(pageIndex + 1)} 页 / 共 ${String(pageCount)} 页`}
      </Text>,
    )
  }
  if (template.tokens.headerLayout === 'split' && pageIndex > 0 && headerName !== null) {
    decorations.push(
      <Text
        key="header-name"
        style={{
          position: 'absolute',
          top: page.marginTop / 2 - HEADER_NAME_FONT_SIZE / 2,
          left: page.marginLeft,
          width: contentWidth(page),
          textAlign: 'right',
          fontFamily: DEFAULT_FONT_FAMILY,
          fontSize: HEADER_NAME_FONT_SIZE,
          color: INK,
        }}
      >
        {headerName}
      </Text>,
    )
  }
  return <>{decorations}</>
}

/** The rule, bar or box the appearance selects for a section heading. */
function sectionHeaderDecoration(
  block: LaidOutBlock,
  source: LayoutBlock,
  page: PageSetup,
  appearance: AppearanceSettings,
  accent: string | null,
): ReactElement | null {
  if (source.role !== 'sectionHeader') return null
  const firstLine = block.lines[0]
  if (firstLine === undefined) return null
  const color = decorationColor(accent)
  const left = page.marginLeft + block.x
  const top = page.marginTop + block.y + (source.paragraphs[0]?.spaceBefore ?? 0)
  const lineHeight = firstLine.style.fontSize * firstLine.style.lineHeight
  switch (appearance.headingStyle) {
    case 'plain':
      return null
    case 'underline':
      return (
        <View
          key={`${block.blockId}-underline`}
          style={{
            position: 'absolute',
            top: top + lineHeight + 1.5,
            left,
            width: block.width,
            height: RULE_THICKNESS,
            backgroundColor: color,
          }}
        />
      )
    case 'accentBar':
      return (
        <View
          key={`${block.blockId}-accent-bar`}
          style={{
            position: 'absolute',
            top,
            left: left - ACCENT_BAR_OFFSET,
            width: ACCENT_BAR_WIDTH,
            height: lineHeight,
            backgroundColor: color,
          }}
        />
      )
    case 'boxed':
      return (
        <View
          key={`${block.blockId}-box`}
          style={{
            position: 'absolute',
            top: top - BOXED_HEADING_PADDING / 2,
            left,
            width: block.width,
            height: lineHeight + BOXED_HEADING_PADDING,
            borderWidth: BOXED_HEADING_BORDER_WIDTH,
            borderColor: color,
          }}
        />
      )
  }
  return null
}
