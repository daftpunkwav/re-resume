/**
 * @file TauriPdfFileSaver
 * @description PdfFileSaver on the Tauri dialog and core plugins: the save
 * dialog picks the destination, the native shell publishes the bytes there.
 *
 * Responsibilities:
 * - Ask the user where the export goes
 * - Hand the chosen destination and the bytes to the native publication
 *   command, which replaces the destination atomically
 *
 * Constraints:
 * - The reachable destinations are fixed by what the save dialog returns; this
 *   module cannot write any other path.
 * - The plugins load lazily, the same as every other Tauri bridge, so tests
 *   and dev-server runs without the IPC surface only pay for what they use.
 * - The webview writes nothing itself: the native command owns the temporary
 *   file and the rename, so no file system scope has to cover the destination's
 *   directory.
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
    const { invoke } = await import('@tauri-apps/api/core')
    // The command takes the bytes as `Vec<u8>`. Sending them as a number array
    // makes the wire shape the command deserializes part of the call itself
    // instead of something the IPC serializer has to infer.
    const payload = { destination: path, bytes: Array.from(bytes) }
    await invoke('publish_export', payload)
    return path
  }
}

function sanitizeFileName(name: string): string {
  return name.replace(FORBIDDEN_NAME_CHARS, ' ').trim()
}
