/**
 * @file redactSecret
 * @description Replaces known credential values in text that is about to be
 * persisted or shown. It lives apart from the run loop because the reserved
 * destructive path needs the same guarantee, and importing it from the loop
 * would be a cycle.
 */

const REDACTED = '[redacted]'

/** Exact-match replacement, so a secret with regex metacharacters is safe. */
export function redactSecret(value: string, secrets: readonly string[]): string {
  let scrubbed = value
  for (const secret of secrets) {
    if (secret.length === 0) continue
    scrubbed = scrubbed.split(secret).join(REDACTED)
  }
  return scrubbed
}

/**
 * Redacts a JSON document's string values, after decoding them.
 *
 * Literal replacement alone is not enough for anything a model wrote: a
 * credential spelled with JSON escapes — the key `sk-live-do-not-store`
 * sent as `\u0073k-live-do-not-store` — is stored as an escape sequence, so
 * the literal secret never appears in the text while it does reappear the
 * moment the row is parsed. Decoding first and serializing the redacted value
 * back closes that gap.
 *
 * Text that is not JSON is left to the literal scrubber: it is a diagnostic
 * message, and refusing to parse it must not make it unpersistable.
 */
export function redactJsonSecrets(argsJson: string, secrets: readonly string[]): string {
  if (secrets.length === 0) return argsJson
  let decoded: unknown
  try {
    decoded = JSON.parse(argsJson) as unknown
  } catch {
    return redactSecret(argsJson, secrets)
  }
  return JSON.stringify(redactValue(decoded, secrets))
}

/**
 * Strings are scrubbed; keys and structure are left alone. Redacting a key
 * would change what the row means to the code that reads it back, and a
 * credential only ever arrives as a value.
 */
function redactValue(value: unknown, secrets: readonly string[]): unknown {
  if (typeof value === 'string') return redactSecret(value, secrets)
  if (Array.isArray(value)) return value.map((entry) => redactValue(entry, secrets))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, redactValue(entry, secrets)]),
  )
}
