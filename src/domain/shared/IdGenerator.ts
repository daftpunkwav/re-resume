/**
 * @file IdGenerator
 * @description Identifier source, injected wherever a new entity is created.
 *
 * Constraints:
 * - Use cases must receive this port rather than calling crypto.randomUUID()
 *   inline, so that identifier allocation stays observable in tests.
 */

export interface IdGenerator {
  next(): string
}
