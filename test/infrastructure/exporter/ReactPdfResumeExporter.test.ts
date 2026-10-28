// @vitest-environment node
/**
 * @file ReactPdfResumeExporter.test
 * @description The PDF renderer against the real bundled faces and the real
 * layout function: the same input the export use case produces, checked through
 * what a PDF reader can get back out of the bytes. Running in node because the
 * fonts are read from the repository; the renderer's own code is
 * platform-neutral and the production path differs only in how the bytes are
 * packaged (Blob in the WebView, buffer here).
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { extractText, getDocumentProxy } from 'unpdf'

import {
  layoutMaterializedDocument,
  materializeDocument,
} from '../../../src/application/resume/materializeDocument'
import type { MaterializeInput } from '../../../src/application/resume/materializeDocument'
import type { CanvasBlock } from '../../../src/domain/resume/CanvasLayout'
import type { ResumeDocumentState } from '../../../src/domain/resume/DocumentState'
import { DEFAULT_FONT_FAMILY } from '../../../src/domain/resume/TextStyle'
import { resolveTemplate } from '../../../src/domain/resume/Template'
import type { PdfExportInput } from '../../../src/domain/resume/ports/ResumePdfExporter'
import { asAttachmentId, asCanvasBlockId, asTemplateId } from '../../../src/domain/shared/branded-id'
import { ReactPdfResumeExporter } from '../../../src/infrastructure/exporter/react-pdf/ReactPdfResumeExporter'
import { createPdfExporter } from '../../../src/infrastructure/exporter/react-pdf/BundledFontPdfExporter'
import type { FontRegistry } from '../../../src/infrastructure/measurement/FontRegistry'
import { createFontkitTextMeasurer } from '../../../src/infrastructure/measurement/FontkitTextMeasurer'
import {
  EMOJI_FONT_FAMILY,
  SYMBOL_FONT_FAMILY,
} from '../../../src/infrastructure/measurement/BundledFontRegistry'
import {
  aDocument,
  anEntryOverride,
  aResume,
  aTwoColumnDocument,
  entriesMap,
  modulesMap,
} from '../../support/resumeFixtures'

const FONT_DIRECTORY = fileURLToPath(new URL('../../../src/assets/fonts/', import.meta.url))

function faceBytes(file: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(readFileSync(`${FONT_DIRECTORY}${file}`))
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
      {
        faces: { regular: faceBytes('NotoSansSymbols2-Regular.otf'), bold: null },
        fallbackFamily: EMOJI_FONT_FAMILY,
      },
    ],
    [
      EMOJI_FONT_FAMILY,
      { faces: { regular: faceBytes('NotoEmoji-Variable.ttf'), bold: null }, fallbackFamily: null },
    ],
  ])
}

const registry = bundledRegistry()
const measurer = createFontkitTextMeasurer(registry)
const exporter = new ReactPdfResumeExporter(registry)

function inputFor(
  document: ResumeDocumentState,
  images: ReadonlyMap<string, string> = new Map(),
): PdfExportInput {
  const template = resolveTemplate(document.templateId)
  const fixture = aResume({ id: 'resume-render', document })
  const materializerInput: MaterializeInput = {
    resume: fixture.resume,
    entries: entriesMap(),
    customModules: modulesMap(),
    template,
    measurer,
  }
  const materialized = materializeDocument(materializerInput)
  const header = materialized.blocks.find((block) => block.id === 'header')
  return {
    blocks: materialized.blocks,
    page: document.pageSetup,
    laidOut: layoutMaterializedDocument(materializerInput, materialized.blocks),
    appearance: document.appearance,
    template,
    headerName: header?.paragraphs[0]?.text ?? null,
    images,
  }
}

async function render(document: ResumeDocumentState): Promise<Uint8Array> {
  return exporter.render(inputFor(document))
}

async function pageCount(bytes: Uint8Array): Promise<number> {
  const document = await getDocumentProxy(new Uint8Array(bytes))
  return document.numPages
}

async function pageTexts(bytes: Uint8Array): Promise<readonly string[]> {
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: false })
  return Array.isArray(text) ? text : [text]
}

async function mergedText(bytes: Uint8Array): Promise<string> {
  const { text } = await extractText(new Uint8Array(bytes), { mergePages: true })
  return text
}

interface TextItem {
  readonly str: string
  readonly x: number
  readonly y: number
}

async function textItemsOnPage(bytes: Uint8Array, pageIndex: number): Promise<readonly TextItem[]> {
  const document = await getDocumentProxy(new Uint8Array(bytes))
  const page = await document.getPage(pageIndex + 1)
  const content = await page.getTextContent()
  return content.items.flatMap((item) =>
    'str' in item && item.str.trim() !== ''
      ? [{ str: item.str, x: item.transform[4], y: item.transform[5] }]
      : [],
  )
}

async function linkUrlsOnPage(bytes: Uint8Array, pageIndex: number): Promise<readonly string[]> {
  const document = await getDocumentProxy(new Uint8Array(bytes))
  const page = await document.getPage(pageIndex + 1)
  const annotations = await page.getAnnotations()
  return annotations
    .filter((annotation) => annotation.subtype === 'Link')
    .map((annotation) => annotation.url)
    .filter((url): url is string => typeof url === 'string')
}

function imageBlock(id: string, attachmentId: string): CanvasBlock {
  return {
    id: asCanvasBlockId(id),
    kind: 'image',
    pageIndex: 0,
    x: 300,
    y: 620,
    width: 96,
    height: 96,
    zIndex: 0,
    text: null,
    textStyle: null,
    attachmentId: asAttachmentId(attachmentId),
  }
}

/** A one-pixel PNG: enough for the renderer to decode and place. */
const ONE_PIXEL_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

describe('ReactPdfResumeExporter', () => {
  it('renders Chinese text that survives extraction, one page per laid-out page', async () => {
    const document = aDocument()
    const input = inputFor(document)
    const bytes = await exporter.render(input)

    expect(bytes.length).toBeGreaterThan(1000)
    expect(await pageCount(bytes)).toBe(input.laidOut.pages.length)
    const text = await mergedText(bytes)
    expect(text).toContain('林清越')
    expect(text).toContain('教育经历')
    expect(text).toContain('项目经历')
    // The faces are embedded (and subset) in the file: extraction succeeding
    // without a system font is what proves the Chinese glyphs travel with it.
    expect(Buffer.from(bytes).toString('latin1')).toContain('FontFile')
  })

  it('centres the header on a centred template and repeats it on later pages of a split one', async () => {
    const classic = await render(aDocument())
    const nameItem = (await textItemsOnPage(classic, 0)).find((item) => item.str.includes('林清越'))
    expect(nameItem).toBeDefined()
    // A left-aligned header would start at the margin; the centred one starts
    // well inside it.
    expect(nameItem?.x ?? 0).toBeGreaterThan(72 + 20)

    const editorialDocument = aDocument({ templateId: asTemplateId('editorial') })
    const editorial = await render(editorialDocument)
    expect(await pageCount(editorial)).toBeGreaterThan(1)
    const secondPage = await textItemsOnPage(editorial, 1)
    const repeated = secondPage.find((item) => item.str.includes('林清越'))
    expect(repeated).toBeDefined()
    if (repeated !== undefined) {
      // The split header draws the name in the top margin, right-aligned.
      expect(repeated.y).toBeGreaterThan(editorialDocument.pageSetup.marginTop - 20)
      expect(repeated.x).toBeGreaterThan(300)
    }
  })

  it('draws the page number in the bottom margin when the page setup asks for it', async () => {
    const base = aDocument()
    const document: ResumeDocumentState = {
      ...base,
      pageSetup: { ...base.pageSetup, showPageNumber: true },
    }
    const input = inputFor(document)
    const bytes = await exporter.render(input)
    const pages = await pageTexts(bytes)
    const total = input.laidOut.pages.length
    expect(pages[0]).toContain(`第 1 页 / 共 ${String(total)} 页`)
    expect(pages[pages.length - 1]).toContain(`第 ${String(total)} 页 / 共 ${String(total)} 页`)
  })

  it('turns the header web links into PDF link annotations', async () => {
    const bytes = await render(aDocument())
    const urls = await linkUrlsOnPage(bytes, 0)
    // The reader normalises a bare host to a trailing slash; the target is
    // still the URL the header drew.
    expect(urls.some((url) => url.startsWith('https://qingyue.example.com'))).toBe(true)
    expect(urls).toContain('https://github.com/qingyue')
    // The URL text stays in the file even where it is not linked.
    expect(await mergedText(bytes)).toContain('https://qingyue.example.com')
  })

  it('keeps a URL in an entry override as plain text', async () => {
    // Override text is user-written, so it is not auto-linked; only the header's
    // own contact lines become annotations.
    const document = aDocument({
      overrides: [anEntryOverride('preview-personal-1', '主页 https://override.example.com')],
    })
    const bytes = await render(document)
    const urls = await linkUrlsOnPage(bytes, 0)

    expect(urls).not.toContain('https://override.example.com')
    expect(await mergedText(bytes)).toContain('https://override.example.com')
  })

  it('draws a resolvable image and the placeholder for a missing one', async () => {
    const document = aDocument({ freeBlocks: [imageBlock('free-image', 'att-image')] })
    const withImage = inputFor(
      document,
      new Map([['att-image', `data:image/png;base64,${ONE_PIXEL_PNG}`]]),
    )
    const rendered = await exporter.render(withImage)
    expect((await mergedText(rendered)).includes('图片缺失')).toBe(false)

    const missing = await exporter.render(inputFor(document))
    expect(await mergedText(missing)).toContain('图片缺失')
    expect(await pageCount(missing)).toBe(withImage.laidOut.pages.length)
  })

  it('paginates exactly as layout() decided', async () => {
    // Blocks are atomic: a document spans pages through many blocks, not one
    // oversized block (which layout reports as an overflow instead).
    const empty = aDocument({ sections: [] })
    const emptyBytes = await render(empty)
    // A zero-page PDF is not a file any viewer accepts, so the renderer emits
    // one blank page even when the layout placed nothing.
    expect(inputFor(empty).laidOut.pages.length).toBe(0)
    expect(await pageCount(emptyBytes)).toBe(1)

    const rich = inputFor(aDocument())
    const bytes = await exporter.render(rich)
    expect(await pageCount(bytes)).toBe(rich.laidOut.pages.length)
    const pages = await pageTexts(bytes)
    expect(pages[0]).toContain('林清越')
    expect(pages[pages.length - 1]).not.toContain('林清越')
  })

  it('renders through the lazily imported factory the roots use', async () => {
    const lazy = createPdfExporter(registry)
    const input = inputFor(aDocument())
    const bytes = await lazy.render(input)

    expect(await pageCount(bytes)).toBe(input.laidOut.pages.length)
    expect(await mergedText(bytes)).toContain('林清越')
  })
})

interface GoldenTemplate {
  readonly template: string
  readonly pages: number
  readonly nameX: number
  readonly nameY: number
  readonly sectionX: number
  readonly sectionY: number
}

/**
 * Captured from one rendering of the fixture document. The page count and the
 * two anchor positions are what a template-token, spacing or page-setup change
 * would move; a failure here is a reviewed diff, not a silent drift.
 */
const GOLDEN_TEMPLATES: readonly GoldenTemplate[] = [
  {
    template: 'classic-single',
    pages: 3,
    nameX: 267.6,
    nameY: 746.7,
    sectionX: 72,
    sectionY: 581,
  },
  {
    template: 'two-column-sidebar',
    pages: 1,
    nameX: 56,
    nameY: 765,
    sectionX: 236,
    sectionY: 734.1,
  },
]

describe('golden templates', () => {
  it('pins the page count and anchor positions of two templates', async () => {
    const rendered: GoldenTemplate[] = []
    for (const golden of GOLDEN_TEMPLATES) {
      const document =
        golden.template === 'two-column-sidebar'
          ? aTwoColumnDocument()
          : aDocument({ templateId: asTemplateId(golden.template) })
      const bytes = await render(document)
      const items = await textItemsOnPage(bytes, 0)
      const name = items.find((item) => item.str.includes('林清越'))
      const section = items.find((item) => item.str === '教育经历')
      rendered.push({
        template: golden.template,
        pages: await pageCount(bytes),
        nameX: round(name?.x ?? 0),
        nameY: round(name?.y ?? 0),
        sectionX: round(section?.x ?? 0),
        sectionY: round(section?.y ?? 0),
      })
    }
    expect(rendered).toEqual(GOLDEN_TEMPLATES)
  })
})

function round(value: number): number {
  return Math.round(value * 10) / 10
}
