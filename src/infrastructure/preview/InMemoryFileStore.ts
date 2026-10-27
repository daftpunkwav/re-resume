/**
 * @file InMemoryFileStore
 * @description Attachment bytes held for the lifetime of the preview session.
 * The shape matches the storage port the conversation layer declares: names
 * carry no path separator, and the reader fails loudly for an unknown name.
 *
 * Constraints:
 * - Preview assembly only. Nothing is written to disk.
 */

const PATH_SEPARATOR_PATTERN = /[\\/]/

export class InMemoryFileStore {
  readonly #files = new Map<string, Uint8Array>()

  async write(storageName: string, bytes: Uint8Array): Promise<void> {
    if (PATH_SEPARATOR_PATTERN.test(storageName)) {
      throw new Error(
        `Refusing to store attachment "${storageName}": a storage name must not contain a path separator.`,
      )
    }
    this.#files.set(storageName, bytes.slice())
  }

  async read(storageName: string): Promise<Uint8Array> {
    const bytes = this.#files.get(storageName)
    if (bytes === undefined) {
      throw new Error(`No preview attachment is stored under "${storageName}".`)
    }
    return bytes.slice()
  }

  async delete(storageName: string): Promise<void> {
    this.#files.delete(storageName)
  }

  async list(): Promise<readonly string[]> {
    return [...this.#files.keys()].sort()
  }
}
