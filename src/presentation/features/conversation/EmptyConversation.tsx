/**
 * @file EmptyConversation
 * @description The welcome region of a session that has no messages yet: what
 * the assistant is for, three things to do next, and the setup warning when no
 * model service is configured.
 *
 * Constraints:
 * - Every quick action does what it says. The job-description action opens a
 *   dialog for pasted text or screenshots and sends what the user provides as
 *   the first user turn; the sample action imports the sample library; the last
 *   one switches to the information panel.
 * - The screenshot path is for a model that reads images: the model picker's
 *   answer is read before sending, and the confirmation is blocked with the
 *   reason instead of letting a turn start that must fail.
 */

import { useRef, useState } from 'react'
import { useApplicationRebuild, useServices } from '../../app/ApplicationServicesProvider'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'
import { TextAreaField } from '../../app/components/TextAreaField'
import { messageOf } from '../../app/settings/settingsErrors'
import { useSettingsStore } from '../../app/stores/settingsStore'
import { useShellStore } from '../../app/stores/shellStore'
import { showToast } from '../../app/stores/toastStore'
import {
  MAX_ATTACHMENT_BYTE_SIZE,
  MAX_MESSAGE_ATTACHMENT_BYTE_SIZE,
  MAX_MESSAGE_ATTACHMENT_COUNT,
} from '../../../domain/conversation/Attachment'
import { formatAttachmentSize } from './attachments/attachmentFormat'
import { AttachmentFileChip } from './attachments/AttachmentFileChip'
import { IMAGE_INPUT_ACCEPT, useImageIntake } from './attachments/useImageIntake'
import type { FeatureIconName } from './icons'
import { FeatureIcon } from './icons'
import { useProviderStore } from './stores/providerStore'
import { useConversationStore } from './stores/conversationStore'

interface QuickAction {
  readonly icon: FeatureIconName
  readonly title: string
  readonly description: string
  readonly onClick: () => void
}

/** The instruction a screenshot-only turn carries; the assistant reads the image. */
const JOB_SCREENSHOT_INSTRUCTION = '帮我针对这个岗位做简历'

interface PlannedFiles {
  readonly files: readonly File[]
  readonly error: string | null
}

/**
 * Applies the message attachment limits to a file selection before the dialog
 * stores anything, so the reader is told about a refused file while it is still
 * their choice. A duplicate file is skipped rather than counted twice.
 */
function planJobScreenshotFiles(
  current: readonly File[],
  incoming: readonly File[],
): PlannedFiles {
  const files = [...current]
  let total = files.reduce((sum, file) => sum + file.size, 0)
  let error: string | null = null
  for (const file of incoming) {
    if (files.some((known) => known.name === file.name && known.size === file.size)) continue
    if (files.length >= MAX_MESSAGE_ATTACHMENT_COUNT) {
      error = `一条消息最多携带 ${String(MAX_MESSAGE_ATTACHMENT_COUNT)} 张图片。`
      break
    }
    if (file.size > MAX_ATTACHMENT_BYTE_SIZE) {
      error = `单张图片不能超过 ${formatAttachmentSize(MAX_ATTACHMENT_BYTE_SIZE)}。`
      continue
    }
    if (total + file.size > MAX_MESSAGE_ATTACHMENT_BYTE_SIZE) {
      error = `一条消息的图片总大小不能超过 ${formatAttachmentSize(MAX_MESSAGE_ATTACHMENT_BYTE_SIZE)}。`
      break
    }
    files.push(file)
    total += file.size
  }
  return { files, error }
}

export function EmptyConversation() {
  const sendMessage = useConversationStore((state) => state.sendMessage)
  const sendWithFiles = useConversationStore((state) => state.sendWithFiles)
  const attachmentError = useConversationStore((state) => state.attachmentError)
  const attachmentIngesting = useConversationStore((state) => state.attachmentIngesting)
  const clearAttachmentError = useConversationStore((state) => state.clearAttachmentError)
  const providerStatus = useProviderStore((state) => state.status)
  const providers = useProviderStore((state) => state.providers)
  const activeProviderId = useProviderStore((state) => state.activeProviderId)
  const setRightPanel = useShellStore((state) => state.setRightPanel)
  const openSettings = useShellStore((state) => state.openSettings)
  const [pasting, setPasting] = useState(false)
  const [jobPosting, setJobPosting] = useState('')
  const [files, setFiles] = useState<readonly File[]>([])
  const [fileError, setFileError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)
  const missingModel = providerStatus === 'ready' && providers.length === 0
  const services = useServices()
  const rebuild = useApplicationRebuild()
  const sampleDataSeeded = useSettingsStore((state) => state.settings.sampleDataSeeded)
  const [seeding, setSeeding] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const activeProvider =
    providers.find((entry) => entry.config.id === activeProviderId) ?? null
  const modelRefusesImages = activeProvider !== null && !activeProvider.supportsImages

  const addFiles = (incoming: readonly File[]): void => {
    const planned = planJobScreenshotFiles(files, incoming)
    setFileError(planned.error)
    setFiles(planned.files)
  }

  const imageIntake = useImageIntake(addFiles, sending, fileInputRef)

  const closeDialog = (): void => {
    if (sending) return
    setPasting(false)
    setFiles([])
    setFileError(null)
    clearAttachmentError()
  }

  const seed = async (): Promise<void> => {
    if (seeding) return
    setSeeding(true)
    try {
      await services.seed.seedSampleData()
      showToast('success', '示例数据已导入，正在重新加载本地数据')
      rebuild()
    } catch (failure) {
      showToast('danger', messageOf(failure))
    } finally {
      setSeeding(false)
    }
  }

  const confirmJobDescription = async (): Promise<void> => {
    const text = jobPosting.trim()
    if (text === '' && files.length === 0) return
    if (files.length > 0 && modelRefusesImages) return
    setSending(true)
    try {
      if (files.length === 0) {
        setPasting(false)
        setJobPosting('')
        await sendMessage(text, [])
        return
      }
      const sent = await sendWithFiles(text === '' ? JOB_SCREENSHOT_INSTRUCTION : text, files)
      if (!sent) return
      setPasting(false)
      setJobPosting('')
      setFiles([])
      setFileError(null)
      clearAttachmentError()
    } finally {
      setSending(false)
    }
  }

  const quickActions: readonly QuickAction[] = [
    {
      icon: 'clipboard',
      title: '粘贴岗位描述',
      description: '粘贴招聘要求，或上传岗位截图，让助手按岗位整理简历。',
      onClick: () => {
        clearAttachmentError()
        setPasting(true)
      },
    },
    ...(sampleDataSeeded
      ? []
      : [
          {
            icon: 'sparkles' as const,
            title: '导入示例数据',
            description: '填入一位虚构候选人的完整资料，先看看完整效果。',
            onClick: () => {
              void seed()
            },
          },
        ]),
    {
      icon: 'pencil',
      title: '完善我的信息',
      description: '在右侧信息面板补充经历，助手只会使用你写下的内容。',
      onClick: () => setRightPanel('info'),
    },
  ]

  const busy = sending || attachmentIngesting > 0
  const errorText = fileError ?? attachmentError?.message ?? null

  return (
    <div className="conversation-empty">
      <div className="welcome">
        <span className="welcome-mark" aria-hidden="true">
          R
        </span>
        <p className="welcome-eyebrow">简历助手</p>
        <h2 className="welcome-title">从一段对话开始</h2>
        <p className="welcome-lead">
          告诉助手目标岗位，它会从你的简历信息中挑选合适的经历，组装成一份针对这份工作的简历。
          你也可以直接让它改写某段经历，或检查简历是否遗漏了关键信息。
        </p>
        {missingModel ? (
          <Notice
            tone="warning"
            title="还没有可用的模型服务"
            actions={
              <Button size="small" variant="secondary" onClick={() => openSettings('model')}>
                去配置
              </Button>
            }
          >
            <p>助手通过模型服务生成回答。配置地址、模型名称与 API Key 后即可开始对话。</p>
          </Notice>
        ) : null}
        <div className="quick-actions">
          {quickActions.map((action) => (
            <button
              type="button"
              className="quick-action"
              key={action.title}
              onClick={action.onClick}
            >
              <span className="quick-action-icon" aria-hidden="true">
                <FeatureIcon name={action.icon} size={16} />
              </span>
              <span className="quick-action-copy">
                <span className="quick-action-title">{action.title}</span>
                <span className="quick-action-description">{action.description}</span>
              </span>
            </button>
          ))}
        </div>
        <p className="welcome-footnote">
          对话保存在本机。助手不会编造你没有提供的经历与数字，随时可以停止生成或撤销它的修改。
        </p>
      </div>

      <Dialog
        open={pasting}
        title="粘贴岗位描述"
        description="粘贴招聘页面的文字，或上传岗位截图。发送后助手会据此理解岗位。"
        confirmLabel="发送给助手"
        busy={busy}
        onClose={closeDialog}
        onConfirm={() => {
          void confirmJobDescription()
        }}
      >
        <div
          onPaste={imageIntake.onPaste}
          onDragEnter={imageIntake.onDragEnter}
          onDragOver={imageIntake.onDragOver}
          onDragLeave={imageIntake.onDragLeave}
          onDrop={imageIntake.onDrop}
        >
          <TextAreaField
            label="岗位描述"
            rows={files.length > 0 ? 4 : 8}
            value={jobPosting}
            placeholder="例如：负责前端页面开发，熟悉 React 与 TypeScript……也可以只上传截图。"
            onChange={(event) => setJobPosting(event.target.value)}
          />
          <div className="job-screenshot-row">
            <Button
              size="small"
              variant="secondary"
              icon="plus"
              disabled={busy}
              onClick={imageIntake.openPicker}
            >
              上传岗位截图
            </Button>
            <span className="job-screenshot-hint">
              也可以直接粘贴或拖入图片。支持 JPG、PNG、WebP、GIF，单张不超过 5 MB。
            </span>
            <input
              ref={fileInputRef}
              className="visually-hidden"
              type="file"
              accept={IMAGE_INPUT_ACCEPT}
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                const picked = [...(event.target.files ?? [])]
                event.target.value = ''
                if (picked.length > 0) addFiles(picked)
              }}
            />
          </div>
          {files.length === 0 ? null : (
            <ul className="composer-attachments job-screenshot-files" aria-label="岗位截图">
              {files.map((file, index) => (
                <AttachmentFileChip
                  key={`${file.name}:${String(file.size)}:${String(index)}`}
                  file={file}
                  index={index}
                  onRemove={() => {
                    setFiles((current) => current.filter((_, at) => at !== index))
                  }}
                />
              ))}
            </ul>
          )}
          {modelRefusesImages && files.length > 0 ? (
            <p className="job-screenshot-warning" role="status">
              当前模型不支持图片输入。请切换到支持图片的模型，或移除截图后粘贴文字。
            </p>
          ) : null}
          {errorText === null ? null : (
            <p className="composer-attachment-error" role="alert">
              {errorText}
            </p>
          )}
          {busy ? <p className="job-screenshot-hint">正在添加图片…</p> : null}
        </div>
      </Dialog>
    </div>
  )
}
