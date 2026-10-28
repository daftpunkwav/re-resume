/**
 * @file ProviderForm
 * @description The create/edit form of one model service. The form owns only the
 * draft; the section owns the capability call and the rebuild that applies it.
 *
 * Constraints:
 * - The API key is write-only: it starts empty on every open, is submitted once
 *   and is never read back from the service. When a credential already exists
 *   the form says so instead of showing part of it.
 * - `supports_images` maps its three states onto the contract: auto is null
 *   (infer from the provider kind and model), the other two are explicit.
 */

import { useState } from 'react'
import type { FormEvent } from 'react'
import type { ProviderListItem } from '../../../application/settings/providerConfiguration'
import type { SaveProviderInput } from '../../../application/settings/saveProvider'
import type { ProviderKind } from '../../../domain/settings/ProviderConfig'
import { Button } from '../components/Button'
import { Notice } from '../components/Notice'
import { SelectField } from '../components/SelectField'
import { TextField } from '../components/TextField'

const KIND_OPTIONS = [
  { value: 'openai-compatible', label: 'OpenAI 兼容接口' },
  { value: 'anthropic', label: 'Anthropic' },
] as const

const IMAGE_SUPPORT_OPTIONS = [
  { value: 'auto', label: '自动判断' },
  { value: 'supported', label: '支持图片' },
  { value: 'unsupported', label: '不支持图片' },
] as const

type ImageSupportChoice = (typeof IMAGE_SUPPORT_OPTIONS)[number]['value']

export interface ProviderFormProps {
  /** The row being edited, or null when creating. */
  readonly editing: ProviderListItem | null
  readonly busy: boolean
  readonly error: string | null
  readonly onSubmit: (input: SaveProviderInput) => void
  readonly onCancel: () => void
}

export function ProviderForm({ editing, busy, error, onSubmit, onCancel }: ProviderFormProps) {
  const [name, setName] = useState(editing?.config.name ?? '')
  const [kind, setKind] = useState<ProviderKind>(editing?.config.kind ?? 'openai-compatible')
  const [baseUrl, setBaseUrl] = useState(editing?.config.baseUrl ?? '')
  const [modelId, setModelId] = useState(editing?.config.modelId ?? '')
  const [apiKey, setApiKey] = useState('')
  const [imageSupport, setImageSupport] = useState<ImageSupportChoice>(
    editing === null || editing.config.supportsImages === null
      ? 'auto'
      : editing.config.supportsImages
        ? 'supported'
        : 'unsupported',
  )

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    onSubmit({
      id: editing?.config.id ?? null,
      name,
      kind,
      baseUrl,
      modelId,
      apiKey: apiKey.trim() === '' ? undefined : apiKey,
      supportsImages:
        imageSupport === 'auto' ? null : imageSupport === 'supported',
    })
  }

  return (
    <form className="provider-form" onSubmit={submit}>
      <div className="settings-grid">
        <TextField
          label="名称"
          value={name}
          required
          placeholder="例如：公司网关"
          hint="用于在列表和模型选择器里区分服务。"
          onChange={(event) => setName(event.target.value)}
        />
        <SelectField
          label="类型"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(event) => setKind(event.target.value as ProviderKind)}
        />
      </div>
      <TextField
        label="Base URL"
        value={baseUrl}
        required
        inputMode="url"
        placeholder="https://api.example.com/v1"
        hint="必须使用 https://；本机服务可以使用 http://localhost。"
        onChange={(event) => setBaseUrl(event.target.value)}
      />
      <TextField
        label="模型 ID"
        value={modelId}
        required
        placeholder="例如：gpt-4.1-mini"
        hint="请求时原样发给服务，不做映射。"
        onChange={(event) => setModelId(event.target.value)}
      />
      <TextField
        label="API Key"
        type="password"
        value={apiKey}
        autoComplete="off"
        placeholder={editing?.hasCredential === true ? '已保存密钥，留空保持不变' : '粘贴 API Key'}
        hint={
          editing?.hasCredential === true
            ? '密钥只保存在系统密钥库中；填写新值会覆盖原来的密钥，保存后输入框立即清空。'
            : '写入后立即从输入框清除，只保存在系统密钥库，不进入数据库、导出或日志。'
        }
        onChange={(event) => setApiKey(event.target.value)}
      />
      <SelectField
        label="图片输入"
        value={imageSupport}
        options={IMAGE_SUPPORT_OPTIONS}
        hint="自动判断会按服务类型与模型名推断，用于决定能否发送 JD 截图。"
        onChange={(event) => setImageSupport(event.target.value as ImageSupportChoice)}
      />
      {error === null ? null : (
        <Notice tone="danger" title="没有保存">
          <p>{error}</p>
        </Notice>
      )}
      <div className="settings-inline-actions">
        <Button type="submit" variant="primary" loading={busy} disabled={busy}>
          {editing === null ? '添加模型服务' : '保存修改'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
          取消
        </Button>
      </div>
    </form>
  )
}
