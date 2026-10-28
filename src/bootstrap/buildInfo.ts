/**
 * @file buildInfo
 * @description Assembles the facts about the running build that the about
 * section shows. Version comes from package.json through the bundler's define;
 * the mode and the container are read from the build environment.
 */

import type { AppInfo } from './capabilities'

export const APPLICATION_LICENSE = 'MIT'

export function describeAppInfo(input: {
  readonly runtime: AppInfo['runtime']
  readonly databaseFile: string | null
}): AppInfo {
  return {
    version: __APP_VERSION__,
    buildMode: import.meta.env.PROD ? 'production' : import.meta.env.MODE,
    runtime: input.runtime,
    license: APPLICATION_LICENSE,
    databaseFile: input.databaseFile,
  }
}
