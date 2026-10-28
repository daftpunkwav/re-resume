/**
 * @file seed wiring
 * @description Assembles the sample-data use case from the facades that already
 * exist, so seeding a fresh window is one call for the settings surface and the
 * conversation empty state.
 *
 * Constraints:
 * - This module only assembles: what the sample contains and the rule that it
 *   runs once live in `application/seed`.
 * - Two triggers that land together (a double click, the settings button and the
 *   welcome action) share one run. The use case marks the settings row at the
 *   end, so without this the second call would start before the first had
 *   written the flag and the sample would be imported twice.
 */

import type { SeedDataService } from '../capabilities'
import type { SeedSampleDataDeps, SeedSampleDataOutput } from '../../application/seed/seedSampleData'
import { seedSampleData } from '../../application/seed/seedSampleData'

export function createSeedDataService(deps: SeedSampleDataDeps): SeedDataService {
  let inFlight: Promise<SeedSampleDataOutput> | null = null
  return {
    seedSampleData: () => {
      inFlight ??= seedSampleData(deps).finally(() => {
        inFlight = null
      })
      return inFlight
    },
  }
}
