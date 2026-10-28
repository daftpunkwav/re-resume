/**
 * @file httpTypes
 * @description The wire vocabulary both provider adapters share: the response
 * header map the transport reports, and the JSON body size ceiling.
 */

/** Largest JSON request body, in characters, before the message is refused. */
export const MAX_REQUEST_BODY_CHARACTER_LENGTH = 20 * 1024 * 1024
