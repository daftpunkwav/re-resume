// @vitest-environment node
/**
 * @file ReactPdfResumeExporter.test
 * @description The PDF renderer against the real bundled faces and the real
 * layout function: the same input the export use case produces, checked
 * through what a PDF reader can get back out of the bytes. Running in node
 * because the fonts are read from the repository; the renderer's own code is
 * platform-neutral and the production path differs only in how the bytes are
 * packaged (Blob in the WebView, buffer here).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'

import { layout } from '../../../src/application/layout/layout'
import { ReactPdfResumeExporter } from '../../../src/infrastructure/exporter/react-pdf/ReactPdfResumeExporter'
import type { FontRegistry } from '../../../src/infrastructure/measurement/FontRegistry'
import { createFontkitTextMeasurer } from '../../../src/infrastructure/measurement/FontkitTextMeasurer'
import {
  EMOJI_FONT_FAMILY,
  SYMBOL_FONT_FAMILY,
} from '../../../src/infrastructure/measurement/BundledFontRegistry'
import { A4_PAGE_SETUP } from '../../../src/domain/resume/PageSetup'
import { DEFAULT_FONT_FAMILY } from '../../../src/domain/resume/TextStyle'
import type { MaterializedBlock } from '../../../src/domain/resume/ResumeSnapshot'
import type { PdfExportInput } from '../../../src/domain/resume/ports/ResumePdfExporter'
import { asBlockId } from '../../../src/domain/shared/branded-id'

const fontDirectory = fileURLToPath(new URL('../../../src/assets/fonts/', import.meta.url))

function faceBytes(file: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(`${fontDirectory}${file}`))
}

/** The same chain the bundled registry loads: default, symbols, emoji. */
function bundledRegistry(): FontRegistry {
  return new Map([
    [
      DEFAULT_FONT_FAMILY,
      {
        faces: {
          regular: faceBytes('NotoSansSC-Regular.otf'),
          bold: faceBytes('NotoSansSC-Bold.otf'),
        },
        fallbackFamily: SYMBOL_FONT_FAMILY,
      },
    ],
    [
      SYMBOL_FONT_FAMILY,
      { faces: { regular: faceBytes('NotoSansSymbols2-Regular.otf'), bold: null }, fallbackFamily: EMOJI_FONT_FAMILY },
    ],
    [EMOJI_FONT_FAMILY, { faces: { regular: faceBytes('NotoEmoji-Variable.ttf'), bold: null }, fallbackFamily: null }],
  ])
}

const registry = bundledRegistry()
const measurer = createFontkitTextMeasurer(registry)
const exporter = new ReactPdfResumeExporter(registry)

function textBlock(id: string, text: string): MaterializedBlock {
  return { id: asBlockId(id), content: { type: 'text', text }, layout: { mode: 'flow', columnSpan: 1 }, textStyle: null, claims: [] }
}

function exportInputOf(blocks: readonly MaterializedBlock[]): PdfExportInput {
  return { blocks, page: A4_PAGE_SETUP, laidOut: layout({ blocks, page: A4_PAGE_SETUP, measurer }) }
}

async function pagesOf(bytes: Uint8Array): Promise<number> {
  const document = await getDocumentProxy(new Uint8Array(bytes))
  return document.numPages
}

async function allText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true })
  return text
}

describe('ReactPdfResumeExporter', () => {
  it('renders CJK text that survives extraction', async () => {
    const bytes = await exporter.render(
      exportInputOf([
        textBlock('block-heading', '工作经历'),
        textBlock('block-body', '负责服务治理，将接口可用性提升到 99.99%。'),
      ]),
    )

    expect(bytes.length).toBeGreaterThan(1000)
    const text = await allText(bytes)
    expect(text).toContain('工作经历')
    expect(text).toContain('负责服务治理')
    expect(await pagesOf(bytes)).toBe(1)
  })

  it('paginates exactly as layout() decided', async () => {
    // Blocks are atomic: a document spans pages through many blocks, not one
    // oversized block (which layout reports as an overflow instead).
    const blocks = Array.from({ length: 60 }, (_, index) =>
      textBlock(`block-line-${index + 1}`, `第${index + 1}段：一段足够长的中文句子，占据真实的行高。`),
    )
    const input = exportInputOf(blocks)

    expect(input.laidOut.pages.length).toBeGreaterThanOrEqual(2)
    const bytes = await exporter.render(input)
    expect(await pagesOf(bytes)).toBe(input.laidOut.pages.length)
    // The count matching is not enough: every block must sit on the page the
    // layout chose for it, or content would be misplaced behind a passing test.
    const { text } = await extractText(new Uint8Array(bytes), { mergePages: false })
    const pages = Array.isArray(text) ? text : [text]
    expect(pages[0]).toContain('第1段')
    expect(pages[pages.length - 1]).toContain('第60段')
  })

  it('does not re-break a line pushed against the right edge', async () => {
    // An absolute block near the right margin leaves the renderer almost no
    // space between the line's left edge and the page edge. Without the
    // measured line width on the box, that remaining space is what the line
    // would be broken against.
    const blockWidth = 320
    const block: MaterializedBlock = {
      id: asBlockId('block-edge'),
      content: {
        type: 'text',
        text: '一行贴着右缘的较长文字，排版已经在本块宽度之内折为了多行，' +
          '这里再补足一段足够长的内容，确保度量器把它折成不止一行，' +
          '从而可以核对渲染器没有在剩余空间里再次折行。',
      },
      layout: {
        mode: 'absolute',
        x: A4_PAGE_SETUP.pageWidth - A4_PAGE_SETUP.marginRight - blockWidth + 250,
        y: 60,
        width: blockWidth,
        height: 200,
        zIndex: 1,
        rotation: 0,
      },
      textStyle: null,
      claims: [],
    }
    const input = exportInputOf([block])
    const laidOutLines = input.laidOut.blocks[0]?.lines.length ?? 0
    expect(laidOutLines).toBeGreaterThan(1)

    const document = await getDocumentProxy(new Uint8Array(await exporter.render(input)))
    const page = await document.getPage(1)
    const content = await page.getTextContent()
    // One y per laid-out line: a renderer-side break would add a y the layout
    // never produced.
    const textItems = content.items.filter(
      (item): item is Extract<(typeof content.items)[number], { str: string }> =>
        'str' in item && item.str.trim() !== '',
    )
    const lineHeightDistinct = new Set(textItems.map((item) => Math.round(item.transform[5])))
    expect(lineHeightDistinct.size).toBe(laidOutLines)
  })

  it('embeds a profile link as a PDF link annotation', async () => {
    const bytes = await exporter.render(
      exportInputOf([
        {
          id: asBlockId('block-profile'),
          content: {
            type: 'profile',
            displayName: '张三',
            email: null,
            phone: null,
            links: [{ label: 'GitHub', url: 'https://github.com/example' }],
          },
          layout: { mode: 'flow', columnSpan: 1 },
          textStyle: null,
          claims: [],
        },
      ]),
    )

    // The annotation's target must be the URL itself, not merely some
    // annotation next to a URL-shaped text.
    const document = await getDocumentProxy(new Uint8Array(bytes))
    const page = await document.getPage(1)
    const annotations = await page.getAnnotations()
    const linkUrls = annotations
      .filter((annotation) => annotation.subtype === 'Link')
      .map((annotation) => annotation.url)
    expect(linkUrls).toContain('https://github.com/example')
    expect(await allText(bytes)).toContain('张三')
  })

  it('renders a divider and an empty document without failing', async () => {
    const divider: MaterializedBlock = {
      id: asBlockId('block-divider'),
      content: { type: 'divider' },
      layout: { mode: 'flow', columnSpan: 1 },
      textStyle: null,
      claims: [],
    }
    const withDivider = await exporter.render(exportInputOf([divider]))
    const empty = await exporter.render(exportInputOf([]))

    // An empty document still yields a single blank page.
    expect(await pagesOf(empty)).toBe(1)
    expect(await pagesOf(withDivider)).toBe(1)
    // The divider is a drawn band: its page carries drawing operators an
    // empty page does not.
    expect(await operationsOnFirstPage(withDivider)).toBeGreaterThan(
      await operationsOnFirstPage(empty),
    )
  })
})

/** Drawing-operator count of page 1: what distinguishes a drawn band from a blank page. */
async function operationsOnFirstPage(bytes: Uint8Array): Promise<number> {
  const document = await getDocumentProxy(new Uint8Array(bytes))
  // pdfjs page indices are 1-based.
  const page = await document.getPage(1)
  return (await page.getOperatorList()).fnArray.length
}
