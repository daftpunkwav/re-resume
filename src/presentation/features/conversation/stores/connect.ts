/**
 * @file connect
 * @description Maps the composition root onto the service bundles the
 * conversation stores hold. Kept apart from the view so the view hands over one
 * object and the stores depend on their own small contracts.
 */

import type { CompositionRoot, ProviderService } from '../../../../bootstrap/capabilities'
import type { ConversationServices } from './conversationStore'

export interface ConversationStores {
  readonly conversation: ConversationServices
  readonly providers: ProviderService
}

export function storesForRoot(root: CompositionRoot): ConversationStores {
  return {
    conversation: {
      conversation: root.conversation,
      info: root.info,
      settings: root.settings,
      libraryChanges: root.libraryChanges,
    },
    providers: root.providers,
  }
}
