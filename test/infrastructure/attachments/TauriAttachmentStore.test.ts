/**
 * @file TauriAttachmentStore.test
 * @description The IPC contract of the native attachment store: the arguments
 * the four commands receive, the byte conversion, and the rejection of names
 * that must never reach the native side.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}))

import { TauriAttachmentStore } from '../../../src/infrastructure/attachments/TauriAttachmentStore'

describe('TauriAttachmentStore', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('writes the storage name and bytes through the native command', async () => {
    invoke.mockResolvedValue(undefined)
    const store = new TauriAttachmentStore()

    await store.write('capture-1.png', new Uint8Array([1, 2, 255]))

    expect(invoke).toHaveBeenCalledWith('write_attachment_file', {
      storageName: 'capture-1.png',
      bytes: [1, 2, 255],
    })
  })

  it('reads the native byte array as bytes', async () => {
    invoke.mockResolvedValue([0, 128, 255])
    const store = new TauriAttachmentStore()

    await expect(store.read('capture-1.png')).resolves.toEqual(new Uint8Array([0, 128, 255]))
    expect(invoke).toHaveBeenCalledWith('read_attachment_file', { storageName: 'capture-1.png' })
  })

  it('deletes through the native command', async () => {
    invoke.mockResolvedValue(undefined)
    const store = new TauriAttachmentStore()

    await store.delete('capture-1.png')
    expect(invoke).toHaveBeenCalledWith('delete_attachment_file', {
      storageName: 'capture-1.png',
    })
  })

  it('lists the names the native side returns', async () => {
    invoke.mockResolvedValue(['a.png', 'b.jpg'])
    const store = new TauriAttachmentStore()

    await expect(store.list()).resolves.toEqual(['a.png', 'b.jpg'])
    expect(invoke).toHaveBeenCalledWith('list_attachment_files', {})
  })

  it('refuses a path separator without calling the native command', async () => {
    const store = new TauriAttachmentStore()

    await expect(store.write('../escape.png', new Uint8Array([1]))).rejects.toThrow(
      /must not contain a path separator/,
    )
    await expect(store.read('nested/escape.png')).rejects.toThrow(
      /must not contain a path separator/,
    )
    await expect(store.delete('C:\\capture.png')).rejects.toThrow(
      /must not contain a path separator/,
    )
    expect(invoke).not.toHaveBeenCalled()
  })

  it('names the failed operation and the native reason', async () => {
    invoke.mockRejectedValue('the attachment file is missing')
    const store = new TauriAttachmentStore()

    await expect(store.read('capture-1.png')).rejects.toThrow(
      'The attachment command read_attachment_file failed: the attachment file is missing',
    )
  })

  it('refuses a malformed native answer instead of returning wrong bytes', async () => {
    invoke.mockResolvedValue([1, 300])
    const store = new TauriAttachmentStore()

    await expect(store.read('capture-1.png')).rejects.toThrow(/not a byte/)
    invoke.mockResolvedValue('not a list')
    await expect(store.list()).rejects.toThrow(/not a list of names/)
  })
})
