/**
 * @file recoverInterruptedRuns
 * @description Repairs the state a crashed process leaves behind. A run that is
 * still `running` at startup belongs to an execution that no longer exists; its
 * assistant messages stop streaming and its tool cards stop running, so the
 * interface never shows a permanent "generating" state.
 *
 * Constraints:
 * - Only rows belonging to the interrupted run are touched. Another process's
 *   live run cannot exist here: the database connection is this process's.
 */

import type { Message } from '../../domain/conversation/Message'
import type { MessageRepository } from '../../domain/conversation/ports/MessageRepository'
import type { AgentRun } from '../../domain/generation/AgentRun'
import { failRun } from '../../domain/generation/AgentRun'
import type { AgentRunRepository } from '../../domain/generation/ports/AgentRunRepository'
import type { Clock } from '../../domain/shared/Clock'

/** Error text written to a run and its messages after a crash. */
export const INTERRUPTED_RUN_ERROR_TEXT = '上次运行被中断'

/** Upper bound of messages read per conversation during recovery. */
const RECOVERY_MESSAGE_LIMIT = 2000

export interface RecoverInterruptedRunsDeps {
  readonly runs: AgentRunRepository
  readonly messages: MessageRepository
  readonly clock: Clock
}

export interface RecoverySummary {
  readonly failedRuns: number
  readonly repairedMessages: number
}

export async function recoverInterruptedRuns(
  deps: RecoverInterruptedRunsDeps,
): Promise<RecoverySummary> {
  const running = await deps.runs.listRunning()
  let failedRuns = 0
  let repairedMessages = 0
  for (const run of running) {
    repairedMessages += await repairMessages(deps, run)
    await deps.runs.save(failRun(run, INTERRUPTED_RUN_ERROR_TEXT, deps.clock.now()))
    failedRuns += 1
  }
  return { failedRuns, repairedMessages }
}

async function repairMessages(deps: RecoverInterruptedRunsDeps, run: AgentRun): Promise<number> {
  if (run.conversationId === null) return 0
  const messages = await deps.messages.listByConversation(
    run.conversationId,
    RECOVERY_MESSAGE_LIMIT,
  )
  let repaired = 0
  for (const message of messages) {
    if (message.runId !== run.id) continue
    const repairedMessage = repairMessage(message)
    if (repairedMessage === null) continue
    await deps.messages.update(repairedMessage)
    repaired += 1
  }
  return repaired
}

function repairMessage(message: Message): Message | null {
  if (message.kind === 'assistant' && message.status === 'streaming') {
    return {
      ...message,
      status: 'cancelled',
      errorText: INTERRUPTED_RUN_ERROR_TEXT,
    }
  }
  if (message.kind === 'tool' && message.status === 'running') {
    return {
      ...message,
      status: 'failed',
      errorText: INTERRUPTED_RUN_ERROR_TEXT,
    }
  }
  return null
}
