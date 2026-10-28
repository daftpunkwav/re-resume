/**
 * @file TauriAttachmentStore
 * @description The native attachment byte store: the four file commands of the
 * Rust shell, behind the `FileStore` port the conversation layer declares.
 *
 * Responsibilities:
 * - Send the bytes and the storage name to the native commands
 * - Convert the command result back into the byte array the caller expects
 * - Refuse a storage name that contains a path separator before it reaches IPC
 *
 * Constraints:
 * - The webview holds no file-system permission. The only write path is the
 *   application command registered in `src-tauri/src/attachments.rs`, which
 *   resolves the directory itself and validates the name again.
 * - Bytes cross IPC as a JSON array of numbers; this matches how the export
 *   command already carries a document. The commands are async on the native
 *   side, so a large read never blocks the window's event loop.
 * - Errors from the native side are wrapped with the operation and the name, so
 *   a failed ingest names what failed rather than "unknown error".
 */

import { invoke } from '@tauri-apps/api/core'
import type { FileStore } from '../../domain/conversation/ports/FileStore'

const WRITE_COMMAND = 'write_attachment_file'
const READ_COMMAND = 'read_attachment_file'
const DELETE_COMMAND = 'delete_attachment_file'
const LIST_COMMAND = 'list_attachment_files'

const PATH_SEPARATOR_PATTERN = /[\\/]/

/** Rejects names the native store would refuse, before an IPC round trip. */
function assertPlainStorageName(storageName: string): void {
  if (storageName === '') {
    throw new Error('Refusing to use an empty attachment storage name.')
  }
  if (PATH_SEPARATOR_PATTERN.test(storageName) || storageName.includes(':')) {
    throw new Error(
      `Refusing to use attachment "${storageName}": a storage name must not contain a path separator.`,
    )
  }
}

async function call(command: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    return await invoke(command, args)
  } catch (failure) {
    throw new Error(`The attachment command ${command} failed: ${describe(failure)}`)
  }
}

function describe(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure)
}

/** Converts the native `Vec<u8>` result into bytes, refusing a malformed answer. */
function toBytes(answer: unknown): Uint8Array {
  if (!Array.isArray(answer)) {
    throw new Error('The attachment read returned no byte array.')
  }
  return Uint8Array.from(answer, (value: unknown) => {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
      throw new Error(`The attachment read returned a value that is not a byte: ${String(value)}`)
    }
    return value
  })
}

export class TauriAttachmentStore implements FileStore {
  async write(storageName: string, bytes: Uint8Array): Promise<void> {
    assertPlainStorageName(storageName)
    await call(WRITE_COMMAND, { storageName, bytes: Array.from(bytes) })
  }

  async read(storageName: string): Promise<Uint8Array> {
    assertPlainStorageName(storageName)
    return toBytes(await call(READ_COMMAND, { storageName }))
  }

  async delete(storageName: string): Promise<void> {
    assertPlainStorageName(storageName)
    await call(DELETE_COMMAND, { storageName })
  }

  async list(): Promise<readonly string[]> {
    const answer = await call(LIST_COMMAND, {})
    if (!Array.isArray(answer) || answer.some((value) => typeof value !== 'string')) {
      throw new Error('The attachment listing returned something that is not a list of names.')
    }
    return answer
  }
}
