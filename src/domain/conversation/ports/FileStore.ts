/**
 * @file FileStore
 * @description Attachment byte storage. The store owns one fixed directory; the
 * caller supplies a storage name that carries no path separator, so an
 * attachment name can never reach outside it.
 *
 * Constraints:
 * - Implementations reject any storage name containing a path separator, a
 *   drive letter or a traversal segment.
 */

export interface FileStore {
  write(storageName: string, bytes: Uint8Array): Promise<void>
  read(storageName: string): Promise<Uint8Array>
  delete(storageName: string): Promise<void>
  list(): Promise<readonly string[]>
}
