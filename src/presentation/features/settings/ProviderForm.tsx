/**
 * @file ProviderForm
 * @description Editor for the model service configuration and for the vault
 * password that opens the encrypted credential store.
 *
 * Responsibilities:
 * - Write the provider descriptor through the provider settings store
 * - Hand the vault password to the store for the length of the session
 * - Clear the descriptor behind a confirmation
 * - State, in the interface, what an agent run sends and what the password does
 *
 * Constraints:
 * - The descriptor is ordinary settings and is persisted. The password is not:
 *   the store keeps it in memory only, and closing the application discards it.
 * - The form never receives a credential. It writes the key the credential is
 *   stored under, which is what keeps the value itself unreachable from here.
 */

import { useCallback, useState } from 'react'
import { useProviderSettings } from '../../app/providerSettingsStore'
import type { ProviderKind, ProviderSettings } from '../../app/providerSettingsStore'
import { useOperation } from '../../app/useOperation'
import type { ReadableError } from '../../app/errorMessages'
import { Button } from '../../app/components/Button'
import { Dialog } from '../../app/components/Dialog'
import { Notice } from '../../app/components/Notice'
import { Panel } from '../../app/components/Panel'
import { SelectField } from '../../app/components/SelectField'
import { TextField } from '../../app/components/TextField'

const PROVIDER_KINDS = [
  { value: 'openai-compatible', label: 'OpenAI 兼容接口' },
  { value: 'anthropic', label: 'Anthropic' },
] as const satisfies readonly { readonly value: ProviderKind; readonly label: string }[]

interface ProviderFormState {
  readonly kind: ProviderKind
  readonly id: string
  readonly modelId: string
  readonly baseUrl: string
  readonly apiKeyRef: string
}

const EMPTY_PROVIDER: ProviderFormState = {
  kind: 'openai-compatible',
  id: '',
  modelId: '',
  baseUrl: '',
  apiKeyRef: '',
}

function toFormState(settings: ProviderSettings | null): ProviderFormState {
  if (settings === null) return EMPTY_PROVIDER
  return {
    kind: settings.kind,
    id: settings.id,
    modelId: settings.modelId,
    baseUrl: settings.baseUrl,
    apiKeyRef: settings.apiKeyRef,
  }
}

/**
 * The form reads its initial values from this key, not from an effect: a save
 * or a clear changes what the store holds, and therefore this key, and React
 * mounts the fields again from the new value.
 */
function descriptorKey(settings: ProviderSettings | null): string {
  if (settings === null) return 'unset'
  return [settings.kind, settings.id, settings.modelId, settings.baseUrl, settings.apiKeyRef].join('|')
}

export function ProviderForm() {
  const settings = useProviderSettings((state) => state.settings)
  const vaultPassword = useProviderSettings((state) => state.vaultPassword)
  const clearSettings = useProviderSettings((state) => state.clearSettings)
  const unlockVault = useProviderSettings((state) => state.unlockVault)

  const [password, setPassword] = useState('')
  const [confirmingClear, setConfirmingClear] = useState(false)

  const unlock = useOperation(
    useCallback(async () => {
      unlockVault(password)
      setPassword('')
    }, [password, unlockVault]),
  )

  const clear = useOperation(
    useCallback(async () => {
      clearSettings()
    }, [clearSettings]),
    () => setConfirmingClear(false),
  )

  return (
    <div className="stack">
      <Panel title="模型服务">
        <ProviderDescriptorFields key={descriptorKey(settings)} initial={toFormState(settings)} />
      </Panel>

      <Panel title="凭据库">
        <div className="stack">
          <TextField
            label="凭据库密码"
            type="password"
            value={password}
            disabled={unlock.busy}
            autoComplete="off"
            hint="只保存在内存里，本次会话内有效，不会写入磁盘。应用打开加密存储时读取它，关闭应用即失效。"
            onChange={(event) => {
              unlock.clearError()
              setPassword(event.target.value)
            }}
          />

          {vaultPassword.length === 0 ? null : (
            <Notice tone="success" title="凭据库已在本次会话解锁">
              <p>这个密码不会离开内存，重新打开应用需要再输入一次。</p>
            </Notice>
          )}

          {unlock.error === null ? null : <OperationFailure title="解锁失败" failure={unlock.error} />}

          <div className="settings-actions">
            <Button
              icon="check"
              disabled={unlock.busy || password.length === 0}
              onClick={() => void unlock.run()}
            >
              解锁凭据库
            </Button>
          </div>
        </div>
      </Panel>

      <Panel title="隐私">
        <Notice tone="info" title="Agent 任务会发送什么">
          <p>
            运行 Agent 任务时，应用通过 Tauri 的 HTTP 插件，把系统提示词、你的指令、模型的回复和工具执行结果，发送到你上面填写的接口地址。代码里没有别的出站请求，个人资料、经历和简历都保存在本地数据库中。
          </p>
        </Notice>
      </Panel>

      <div className="settings-danger-row">
        <Button
          variant="danger"
          icon="trash"
          disabled={clear.busy || settings === null}
          onClick={() => setConfirmingClear(true)}
        >
          清除模型服务配置
        </Button>
      </div>

      <Dialog
        open={confirmingClear}
        title="清除模型服务配置"
        description="清除后，本地不再保存服务类型、模型标识和接口地址。凭据库里的密钥不受影响。"
        confirmLabel="清除"
        destructive
        busy={clear.busy}
        onConfirm={() => void clear.run()}
        onClose={() => setConfirmingClear(false)}
      >
        {clear.error === null ? null : <OperationFailure title="清除失败" failure={clear.error} />}
      </Dialog>
    </div>
  )
}

function ProviderDescriptorFields({ initial }: { readonly initial: ProviderFormState }) {
  const saveSettings = useProviderSettings((state) => state.saveSettings)
  const [form, setForm] = useState(initial)

  const save = useOperation(
    useCallback(async () => {
      saveSettings({
        kind: form.kind,
        id: form.id.trim(),
        modelId: form.modelId.trim(),
        baseUrl: form.baseUrl.trim(),
        apiKeyRef: form.apiKeyRef.trim(),
      })
    }, [form, saveSettings]),
  )

  const replaceForm = (next: Partial<ProviderFormState>): void => {
    save.clearError()
    setForm((current) => ({ ...current, ...next }))
  }

  const complete =
    form.id.trim().length > 0 &&
    form.modelId.trim().length > 0 &&
    form.baseUrl.trim().length > 0 &&
    form.apiKeyRef.trim().length > 0

  return (
    <form
      className="stack"
      onSubmit={(event) => {
        event.preventDefault()
        void save.run()
      }}
    >
      <div className="form-grid">
        <SelectField
          label="服务类型"
          options={PROVIDER_KINDS}
          value={form.kind}
          disabled={save.busy}
          onChange={(event) => replaceForm({ kind: event.target.value as ProviderKind })}
        />
        <TextField
          label="服务标识"
          value={form.id}
          disabled={save.busy}
          autoComplete="off"
          onChange={(event) => replaceForm({ id: event.target.value })}
        />
        <TextField
          label="模型标识"
          value={form.modelId}
          disabled={save.busy}
          autoComplete="off"
          onChange={(event) => replaceForm({ modelId: event.target.value })}
        />
        <TextField
          label="接口地址"
          value={form.baseUrl}
          disabled={save.busy}
          autoComplete="off"
          placeholder="https://api.openai.com/v1"
          onChange={(event) => replaceForm({ baseUrl: event.target.value })}
        />
        <TextField
          className="form-grid-wide"
          label="凭据引用键"
          value={form.apiKeyRef}
          disabled={save.busy}
          autoComplete="off"
          hint="凭据库中保存这个服务 API 密钥所用的键名。密钥本身存在 Stronghold 加密存储里，这个表单只写入键名。"
          onChange={(event) => replaceForm({ apiKeyRef: event.target.value })}
        />
      </div>

      {save.error === null ? null : <OperationFailure title="保存失败" failure={save.error} />}

      <div className="settings-actions">
        <Button type="submit" variant="primary" disabled={save.busy || !complete}>
          保存
        </Button>
      </div>
    </form>
  )
}

/**
 * Duplicated in ProfileForm rather than shared: both forms are siblings under
 * SettingsView, so a shared piece would have to live in one of the two or come
 * back out of SettingsView, which they both already import from.
 */
function OperationFailure({
  title,
  failure,
}: {
  readonly title: string
  readonly failure: ReadableError
}) {
  return (
    <Notice tone="danger" title={title}>
      <p>{failure.message}</p>
      {failure.blockers.length === 0 ? null : (
        <ul className="settings-blockers">
          {failure.blockers.map((blocker) => (
            <li key={blocker}>{blocker}</li>
          ))}
        </ul>
      )}
    </Notice>
  )
}
