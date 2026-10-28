/**
 * @file pdfDoubles
 * @description Test doubles for the two PDF ports. The use-case tests assert
 * what the export handed over; the renderer that consumes real bytes has its
 * own test, so the doubles stay deliberately dumb.
 */

import type { PdfExportInput, ResumePdfExporter } from '../../src/domain/resume/ports/ResumePdfExporter'
import type { PdfFileSaver } from '../../src/domain/resume/ports/PdfFileSaver'

/** The four magic bytes every PDF starts with. */
export const FIXED_PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46])

/** Records every input the export rendered and returns fixed bytes. */
export class FixedBytesPdfExporter implements ResumePdfExporter {
  readonly inputs: PdfExportInput[] = []

  constructor(private readonly bytes: Uint8Array = FIXED_PDF_BYTES) {}

  async render(input: PdfExportInput): Promise<Uint8Array> {
    this.inputs.push(input)
    return this.bytes.slice()
  }
}

/** Records every save call; a null result models the dismissed dialog. */
export class RecordingPdfFileSaver implements PdfFileSaver {
  readonly calls: { readonly bytes: Uint8Array; readonly suggestedName: string }[] = []

  constructor(private readonly result: string | null = 'C:\\exports\\resume.pdf') {}

  async save(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
    this.calls.push({ bytes, suggestedName })
    return this.result
  }
}

/** A saver whose dialog is cancelled. */
export class CancellingPdfFileSaver implements PdfFileSaver {
  async save(): Promise<string | null> {
    return null
  }
}
