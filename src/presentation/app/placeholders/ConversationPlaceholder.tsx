/**
 * @file ConversationPlaceholder
 * @description The empty state of the conversation region.
 *
 * The conversation feature (PR-07) replaces this file with the message stream,
 * composer and tool cards. Until then the region shows what it is for and does
 * not pretend to accept input.
 */

import { useShellStore } from '../stores/shellStore'

export function ConversationPlaceholder() {
  // A new conversation replays the entrance, which is the one visible effect
  // of creating a session before sessions are stored anywhere.
  const draftEpoch = useShellStore((state) => state.draftEpoch)

  return (
    <div className="conversation-scroll">
      <div className="welcome" key={draftEpoch}>
        <span className="welcome-mark" aria-hidden="true">
          R
        </span>
        <p className="welcome-eyebrow">简历助手</p>
        <h2 className="welcome-title">从一段对话开始</h2>
        <p className="welcome-lead">
          告诉助手目标岗位，它会从你的简历信息中挑选合适的经历，组装成一份针对这份工作的简历。
        </p>
        <p className="welcome-footnote">
          用左侧的「简历信息」维护经历，用「简历创作」查看组装结果。
        </p>
      </div>
    </div>
  )
}
