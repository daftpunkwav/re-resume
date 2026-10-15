/**
 * @file StrongholdSecretStore
 * @description Ciphertext storage for provider credentials. Only the reference
 * returned here is ever written to SQLite; the secret itself lives in the
 * Stronghold snapshot and never reaches the database, a log line or an export.
 *
 * Constraints:
 * - The password must come from the user or the OS credential prompt and must
 *   not be persisted anywhere. It is held in memory for the lifetime of this
 *   object.
 * - Records are kept in the client's key-value Store rather than in a Vault.
 *   In `@tauri-apps/plugin-stronghold` 2.4.0 the Vault exposes only insert,
 *   remove and the SLIP10/Ed25519 procedures — it has no read command at all
 *   (see dist-js/index.d.ts), so a Vault-stored secret cannot be loaded back
 *   from this runtime. The Store is the only readable path, and it lives
 *   inside the same password-encrypted snapshot.
 * - Every mutation is followed by Stronghold.save(): the snapshot is only
 *   persisted when it is explicitly saved.
 */

import type { Client, Store, Stronghold as StrongholdInstance } from '@tauri-apps/plugin-stronghold'
import type { SecretStore } from '../../domain/generation/ports/SecretStore'

/** The snapshot holds one client; this store owns all records inside it. */
const DEFAULT_CLIENT_NAME = 're-resume'

/** Namespaces secret records so a future use of the client cannot collide. */
const SECRET_RECORD_PREFIX = 'secret:'

export interface StrongholdSecretStoreOptions {
  /** Absolute path of the .hold snapshot file. */
  readonly snapshotPath: string
  /** Snapshot password, supplied at unlock time and never stored. */
  readonly password: string
  readonly clientName?: string
}

interface StrongholdSession {
  readonly stronghold: StrongholdInstance
  readonly store: Store
}

export class StrongholdSecretStore implements SecretStore {
  readonly #options: StrongholdSecretStoreOptions
  #session: Promise<StrongholdSession> | null = null

  constructor(options: StrongholdSecretStoreOptions) {
    this.#options = options
  }

  async store(ref: string, secret: string): Promise<void> {
    const { stronghold, store } = await this.#open()
    await store.insert(this.#recordKey(ref), Array.from(new TextEncoder().encode(secret)))
    await stronghold.save()
  }

  async load(ref: string): Promise<string | null> {
    const { store } = await this.#open()
    const bytes = await store.get(this.#recordKey(ref))
    if (bytes === null) return null
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } catch (error) {
      throw new Error(
        `The Stronghold record for reference "${ref}" holds bytes that are not valid UTF-8, ` +
          `so it cannot be the secret this store wrote. The snapshot is damaged or was edited.`,
        { cause: error },
      )
    }
  }

  async remove(ref: string): Promise<void> {
    const { stronghold, store } = await this.#open()
    await store.remove(this.#recordKey(ref))
    await stronghold.save()
  }

  #recordKey(ref: string): string {
    return `${SECRET_RECORD_PREFIX}${ref}`
  }

  /**
   * One session for the lifetime of this object. Re-opening the snapshot would
   * contend with the handle the plugin already caches, and a long-lived client
   * is what the plugin's own examples assume.
   */
  async #open(): Promise<StrongholdSession> {
    this.#session ??= this.#openSession()
    return this.#session
  }

  async #openSession(): Promise<StrongholdSession> {
    const { Stronghold } = await import('@tauri-apps/plugin-stronghold')
    const clientName = this.#options.clientName ?? DEFAULT_CLIENT_NAME
    const stronghold = await Stronghold.load(this.#options.snapshotPath, this.#options.password)
    const client = await this.#resolveClient(stronghold, clientName)
    return { stronghold, store: client.getStore() }
  }

  /**
   * A snapshot written on another run has the client; a fresh install does not.
   * Both failures are reported together: if creation also fails, knowing which
   * client name was missing is the difference between a diagnosable error and
   * a guess.
   */
  async #resolveClient(stronghold: StrongholdInstance, clientName: string): Promise<Client> {
    try {
      return await stronghold.loadClient(clientName)
    } catch (loadFailure) {
      try {
        return await stronghold.createClient(clientName)
      } catch (createFailure) {
        throw new Error(
          `Stronghold client "${clientName}" is absent from the snapshot and could not be created. ` +
            `Loading it failed with: ${describe(loadFailure)}. Creating it failed with: ${describe(createFailure)}`,
          { cause: createFailure },
        )
      }
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
