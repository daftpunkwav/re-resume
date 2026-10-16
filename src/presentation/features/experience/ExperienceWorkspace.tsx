/**
 * @file ExperienceWorkspace
 * @description The experience catalog region: the index on the left, the open
 * experience on the right, and the one list load both halves read from.
 *
 * Responsibilities:
 * - Load the library once and hand the same resource to both halves
 * - Reload that list after a mutation so the counts on the index stay honest
 *
 * Constraints:
 * - The list is loaded here rather than in the index panel because a mutation
 *   in the detail pane also changes what the index shows.
 */

import { useServices } from '../../app/ApplicationServicesProvider'
import { useNavigation } from '../../app/navigationStore'
import { useResource } from '../../app/useResource'
import { ExperienceDetailPanel } from './ExperienceDetailPanel'
import { ExperienceListPanel } from './ExperienceListPanel'
import './experience.css'

export function ExperienceWorkspace() {
  const library = useServices().experiences
  const experiences = useResource(() => library.list(), [library])
  const selectedExperienceId = useNavigation((state) => state.selectedExperienceId)
  const selectExperience = useNavigation((state) => state.selectExperience)

  return (
    <div className="split">
      <ExperienceListPanel
        library={library}
        experiences={experiences}
        onRemoved={(removedId) => {
          // A selection that outlives its row would leave the detail pane
          // describing something that is no longer in the library.
          if (removedId === selectedExperienceId) selectExperience(null)
        }}
      />
      <ExperienceDetailPanel library={library} onListChanged={experiences.reload} />
    </div>
  )
}
