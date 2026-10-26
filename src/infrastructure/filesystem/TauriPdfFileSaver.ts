/**
 * @file TauriPdfFileSaver
 * @description PdfFileSaver on the Tauri dialog and fs plugins: the save
 * dialog picks the destination, the fs plugin writes the bytes.
 *
 * Constraints:
 * - The reachable destinations are fixed by the application capability file
 *   (the standard document and download directories); this module cannot and
 *   does not widen them.
 * - The plugins load lazily, the same as every other Tauri bridge, so tests
 *   and dev-server runs without the IPC surface only pay for what they use.
 */

import type { PdfFileSaver } from '../../domain/resume/ports/PdfFileSaver'

/**
 * Characters a file name cannot carry on at least one target platform,
 * replaced rather than rejected: the suggested name is a convenience, not
 * input the user typed for this purpose.
 */
const FORBIDDEN_NAME_CHARS = /[/\\:?*"<>|]/g

export class TauriPdfFileSaver implements PdfFileSaver {
  async save(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({
      defaultPath: sanitizeFileName(suggestedName),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    })
    if (path === null) return null
    const { writeFile } = await import('@tauri-apps/plugin-fs')
    await writeFile(path, bytes)
    return path
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(FORBIDDEN_NAME_CHARS, ' ').trim()
}
