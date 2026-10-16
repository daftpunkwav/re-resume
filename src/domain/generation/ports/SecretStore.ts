/**
 * @file SecretStore
 * @description Ciphertext storage for provider credentials. Database rows hold
 * only the reference returned here; the secret itself never enters SQLite,
 * logs or an export.
 */

export interface SecretStore {
  store(ref: string, secret: string): Promise<void>
  load(ref: string): Promise<string | null>
  remove(ref: string): Promise<void>
}
