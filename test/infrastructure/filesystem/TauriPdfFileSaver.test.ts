/**
 * @file TauriPdfFileSaver.test
 * @description The save path against the Tauri plugins: the destination the
 * user chose is handed to the native publication, which owns the write.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { save } from '@tauri-apps/plugin-dialog'
import { invoke } from '@tauri-apps/api/core'
import { TauriPdfFileSaver } from '../../../src/infrastructure/filesystem/TauriPdfFileSaver'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const DESTINATION = 'C:/Users/me/Documents/resume.pdf'
const BYTES = new Uint8Array([1, 2, 3])

function saver(): TauriPdfFileSaver {
  return new TauriPdfFileSaver()
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(save).mockResolvedValue(DESTINATION)
  vi.mocked(invoke).mockResolvedValue(undefined)
})

describe('TauriPdfFileSaver', () => {
  it('hands the chosen destination and the bytes to the native publication', async () => {
    const written = await saver().save(BYTES, 'resume.pdf')

    expect(written).toBe(DESTINATION)
    // The native command takes `bytes: Vec<u8>`, which the IPC body carries as
    // a number array; the assertion pins that shape rather than the input.
    expect(invoke).toHaveBeenCalledWith('publish_export', {
      destination: DESTINATION,
      bytes: [1, 2, 3],
    })
    // The native publication is the only call: the webview asks for no file
    // system command and for no scope grant of its own.
    expect(invoke).toHaveBeenCalledTimes(1)
  })

  it('publishes only after the user chose a destination', async () => {
    await saver().save(BYTES, 'resume.pdf')

    expect(vi.mocked(save).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(invoke).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('suggests a name the file system accepts', async () => {
    await saver().save(BYTES, 'resume:final/v2.pdf')

    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ defaultPath: 'resume final v2.pdf' }),
    )
  })

  it('reports nothing when the user dismisses the dialog', async () => {
    vi.mocked(save).mockResolvedValue(null)

    expect(await saver().save(BYTES, 'resume.pdf')).toBeNull()
    expect(invoke).not.toHaveBeenCalled()
  })

  it('propagates a publication failure', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('the destination is open'))

    await expect(saver().save(BYTES, 'resume.pdf')).rejects.toThrow(
      'the destination is open',
    )
  })
})
