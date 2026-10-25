/**
 * @file buildPdfDocument
 * @description Maps a laid-out resume to the PDF renderer's document tree.
 * The mapping is purely geometric: every line lands where layout() placed it,
 * and the renderer is never allowed to re-wrap or re-paginate.
 *
 * Responsibilities:
 * - Emit one page per laid-out page (at least one, so a valid PDF exists)
 * - Draw each block's precomputed lines at their coordinates, run by run, with
 *   the face each run was measured with
 * - Render a profile block's link URLs as PDF link annotations
 * - Draw a divider as a hairline band
 *
 * Constraints:
 * - Lines are absolutely positioned with wrapping disabled; a renderer-side
 *   line break would move content the pagination never placed there.
 * - A graphic draws nothing: asset storage is undefined, and the unselected
 *   canvas shows nothing for one either, so the outputs agree.
 * - Run baseline shifts are not expressible here; they belong to the residual
 *   cross-engine drawing differences the spec tracks as an open item.
 */

import type { ReactElement, ReactNode } from 'react'
import { Document, Link, Page, Text, View } from '@react-pdf/renderer'
import type { DocumentProps } from '@react-pdf/renderer'

import type { PdfExportInput } from '../../../domain/resume/ports/ResumePdfExporter'
import type { LaidOutBlock } from '../../../domain/resume/PageLayout'
import type { PageSetup } from '../../../domain/resume/PageSetup'
import type { MaterializedBlock } from '../../../domain/resume/ResumeSnapshot'
import type { TextRun } from '../../../domain/resume/ports/TextMeasurer'

/** A drawn rule is the smallest extent a divider block has. */
const DIVIDER_THICKNESS = 1

const INK = '#000000'

export function buildPdfDocument(input: PdfExportInput): ReactElement<DocumentProps> {
  const blocksById = new Map(input.blocks.map((block) => [block.id, block] as const))
  // An empty document still exports: a zero-page PDF is not a file any viewer
  // accepts, so it becomes one blank page.
  const pageCount = Math.max(1, input.laidOut.pages.length)
  return (
    <Document>
      {Array.from({ length: pageCount }, (_, pageIndex) => (
        <Page key={pageIndex} size={[input.page.pageWidth, input.page.pageHeight]}>
          {input.laidOut.blocks
            .filter((block) => block.pageIndex === pageIndex)
            .map((block) => (
              <BlockView
                key={block.blockId}
                laidOut={block}
                page={input.page}
                source={blocksById.get(block.blockId) ?? null}
              />
            ))}
        </Page>
      ))}
    </Document>
  )
}

function BlockView(props: {
  readonly laidOut: LaidOutBlock
  readonly page: PageSetup
  readonly source: MaterializedBlock | null
}): ReactNode {
  const { laidOut, page, source } = props
  const left = page.marginLeft + laidOut.x
  const top = page.marginTop + laidOut.y
  if (source?.content.type === 'divider') {
    return (
      <View
        style={{
          position: 'absolute',
          top,
          left,
          width: laidOut.width,
          height: DIVIDER_THICKNESS,
          backgroundColor: INK,
        }}
      />
    )
  }
  const urls = source !== null && source.content.type === 'profile'
    ? source.content.links.map((link) => link.url).filter(isWebUrl)
    : []
  const { fontSize, lineHeight } = laidOut.textStyle
  const step = fontSize * lineHeight
  return (
    <>
      {laidOut.lines.map((line, index) => (
        <Text
          key={index}
          wrap={false}
          style={{
            position: 'absolute',
            // wrap={false} only stops page wrapping, not line breaking: an
            // absolutely positioned element breaks against the space between
            // its left edge and the page edge. A line near the right margin
            // would have almost none left and get re-broken there. The box is
            // the width the measurer decided the line fits in, so breaking is
            // never triggered no matter where the line sits.
            width: line.width,
            top: top + step * index,
            left: left + line.x,
            fontFamily: laidOut.textStyle.fontFamily,
            fontSize,
            fontWeight: laidOut.textStyle.fontWeight,
            lineHeight,
            color: INK,
          }}
        >
          {line.runs.flatMap((run, runIndex) => runSegments(run, urls, `${index}-${runIndex}`))}
        </Text>
      ))}
    </>
  )
}

/**
 * One run as inline children of its line: a plain span, or the stretches
 * around an embedded link URL with the URL itself linked. The segments are
 * flat elements, not wrapped in a fragment — the renderer's text pass does
 * not look inside fragments, and content behind one silently disappears.
 */
function runSegments(run: TextRun, urls: readonly string[], key: string): ReactElement[] {
  const style = {
    fontFamily: run.fontFamily,
    fontWeight: run.fontWeight,
  }
  const hit = urls.length > 0 ? firstUrlIn(run.text, urls) : null
  if (hit === null) return [<Text key={`${key}-plain`} style={style}>{run.text}</Text>]
  // The link draws its URL inline where the run placed it. It inherits the
  // line's family: every URL character is covered by the line's own faces, so
  // no run-level override is needed for the linked stretch.
  const segments: ReactElement[] = []
  if (hit.before !== '') {
    segments.push(<Text key={`${key}-before`} style={style}>{hit.before}</Text>)
  }
  // The linked stretch carries the run's style too: a URL with characters the
  // line's own faces lack would otherwise draw them in the line's family
  // instead of the fallback face the run was measured with.
  segments.push(
    <Link key={`${key}-link`} src={hit.url}>
      <Text style={style}>{hit.url}</Text>
    </Link>,
  )
  if (hit.after !== '') {
    segments.push(...runSegments({ ...run, text: hit.after }, urls, `${key}-after`))
  }
  return segments
}

/**
 * Only web URLs become link annotations. A file: or custom-scheme URL in the
 * profile would export as a PDF link that invites a recipient's viewer to
 * launch a local handler — the text stays, the clickable annotation does not.
 */
function isWebUrl(url: string): boolean {
  return url.startsWith('https://') || url.startsWith('http://')
}

function firstUrlIn(
  text: string,
  urls: readonly string[],
): { readonly url: string; readonly before: string; readonly after: string } | null {
  for (const url of urls) {
    const index = text.indexOf(url)
    if (index !== -1) {
      return { url, before: text.slice(0, index), after: text.slice(index + url.length) }
    }
  }
  return null
}
