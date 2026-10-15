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
