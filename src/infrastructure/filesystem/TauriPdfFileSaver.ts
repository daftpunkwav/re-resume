/**
 * @file TauriPdfFileSaver
 * @description PdfFileSaver on the Tauri dialog and fs plugins: the save
 * dialog picks the destination, the fs plugin writes the bytes.
 *
 * Responsibilities:
 * - Ask the user where the export goes and write it there
 * - Replace the destination atomically: the bytes land in a temporary file
 *   beside the destination, and the rename publishes them
 *
 * Constraints:
 * - The reachable destinations are fixed by the application capability file
 *   (the standard document and download directories); this module cannot and
 *   does not widen them.
 * - The plugins load lazily, the same as every other Tauri bridge, so tests
 *   and dev-server runs without the IPC surface only pay for what they use.
 * - The temporary file shares the destination's directory, so the rename
 *   replaces the destination on one filesystem instead of moving bytes across
 *   two.
 * - The temporary name carries a unique suffix, so two exports to the same
 *   destination cannot write over each other's bytes.
 */

import type { PdfFileSaver } from '../../domain/resume/ports/PdfFileSaver'
import type { IdGenerator } from '../../domain/shared/IdGenerator'

/**
 * Characters a file name cannot carry on at least one target platform,
 * replaced rather than rejected: the suggested name is a convenience, not
 * input the user typed for this purpose.
 */
const FORBIDDEN_NAME_CHARS = /[/\\:?*"<>|]/g

export class TauriPdfFileSaver implements PdfFileSaver {
  constructor(private readonly ids: IdGenerator) {}

  async save(bytes: Uint8Array, suggestedName: string): Promise<string | null> {
    const { save } = await import('@tauri-apps/plugin-dialog')
    const path = await save({
      defaultPath: sanitizeFileName(suggestedName),
      filters: [{ name: 'PDF document', extensions: ['pdf'] }],
    })
    if (path === null) return null
    await publishThroughTemporaryFile(path, bytes, this.ids.next())
    return path
  }
}

/**
 * Writes the bytes to a temporary file beside the destination and renames it
 * over the destination. A write that fails halfway leaves the previous
 * document intact: only the rename changes the destination, and a rename
 * inside one directory either happens or does not.
 */
async function publishThroughTemporaryFile(
  destination: string,
  bytes: Uint8Array,
  suffix: string,
): Promise<void> {
  const { basename, dirname, join } = await import('@tauri-apps/api/path')
  const { rename, writeFile } = await import('@tauri-apps/plugin-fs')
  const temporary = await join(
    await dirname(destination),
    `${await basename(destination)}.${sanitizeFileName(suffix)}.part`,
  )
  try {
    await writeFile(temporary, bytes)
    await rename(temporary, destination)
  } catch (failure) {
    await discardTemporaryFile(temporary, failure)
    throw failure
  }
}

/**
 * Removes the temporary file an export left behind. A cleanup that fails is
 * reported together with the failure that caused it: the export did not
 * happen either way, and the leftover file is what the user has to know.
 */
async function discardTemporaryFile(temporary: string, failure: unknown): Promise<void> {
  const { exists, remove } = await import('@tauri-apps/plugin-fs')
  try {
    // A write that never reached the disk leaves no file behind, and removing
    // a file that was never created is itself an error.
    if (!(await exists(temporary))) return
    await remove(temporary)
  } catch (cleanupFailure) {
    throw new Error(
      `The export failed (${describeFailure(failure)}) and the temporary file "${temporary}" could not be removed: ${describeFailure(cleanupFailure)}`,
      { cause: failure },
    )
  }
}

function describeFailure(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

function sanitizeFileName(name: string): string {
  return name.replace(FORBIDDEN_NAME_CHARS, ' ').trim()
}
