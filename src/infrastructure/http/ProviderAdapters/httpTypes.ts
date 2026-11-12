/**
 * @file httpTypes
 * @description The wire vocabulary both provider adapters share: the response
 * header map the transport reports, and the JSON body size ceiling.
 */

/** Largest JSON request body, in characters, before the message is refused. */
export const MAX_REQUEST_BODY_CHARACTER_LENGTH = 20 * 1024 * 1024

/**
 * Joins a configured base URL with an API path, dropping the base URL's
 * trailing slashes. The loop replaces the anchored regex so the trim cannot
 * backtrack over the whole URL.
 */
export function baseUrlEndpoint(baseUrl: string, path: string): string {
  let origin = baseUrl
  while (origin.endsWith('/')) origin = origin.slice(0, -1)
  return `${origin}${path}`
}
