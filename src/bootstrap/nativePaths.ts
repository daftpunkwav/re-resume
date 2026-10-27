/**
 * @file nativePaths
 * @description Native path resolution that belongs to the bootstrap layer: the
 * interface asks for the credential snapshot location, and this is the module
 * that may name the Tauri path API on its behalf.
 */

/** Absolute path of the encrypted credential snapshot the vault opens. */
export async function resolveCredentialsSnapshotPath(): Promise<string> {
  const { appDataDir, join } = await import('@tauri-apps/api/path')
  return join(await appDataDir(), 'credentials.hold')
}
