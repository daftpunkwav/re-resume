/**
 * @file TauriPdfFileSaver.test
 * @description The save path against the Tauri plugins: where the bytes are
 * written, and what the destination is left with when the write fails.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { save } from '@tauri-apps/plugin-dialog'
import { exists, remove, rename, writeFile } from '@tauri-apps/plugin-fs'
import { basename, dirname, join } from '@tauri-apps/api/path'
import { invoke } from '@tauri-apps/api/core'
import { TauriPdfFileSaver } from '../../../src/infrastructure/filesystem/TauriPdfFileSaver'
import { SequentialIdGenerator } from '../../support/fakeEnvironment'

vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }))
vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: vi.fn(),
  remove: vi.fn(),
  rename: vi.fn(),
  writeFile: vi.fn(),
}))
vi.mock('@tauri-apps/api/path', () => ({
  basename: vi.fn(),
  dirname: vi.fn(),
  join: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))

const DESTINATION = 'C:/Users/me/Documents/resume.pdf'
const DIRECTORY = 'C:/Users/me/Documents'
const TEMPORARY = 'C:/Users/me/Documents/resume.pdf.tmp-1.part'
const BYTES = new Uint8Array([1, 2, 3])

function saver(): TauriPdfFileSaver {
  return new TauriPdfFileSaver(new SequentialIdGenerator('tmp'))
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(save).mockResolvedValue(DESTINATION)
  vi.mocked(dirname).mockResolvedValue(DIRECTORY)
  vi.mocked(basename).mockResolvedValue('resume.pdf')
  vi.mocked(join).mockImplementation(async (...parts: string[]) => parts.join('/'))
  vi.mocked(writeFile).mockResolvedValue(undefined)
  vi.mocked(rename).mockResolvedValue(undefined)
  vi.mocked(remove).mockResolvedValue(undefined)
  vi.mocked(exists).mockResolvedValue(true)
  vi.mocked(invoke).mockResolvedValue(undefined)
})

describe('TauriPdfFileSaver', () => {
  it('writes into a temporary file beside the destination and renames it over it', async () => {
    const written = await saver().save(BYTES, 'resume.pdf')

    expect(written).toBe(DESTINATION)
    expect(writeFile).toHaveBeenCalledWith(TEMPORARY, BYTES)
    expect(rename).toHaveBeenCalledWith(TEMPORARY, DESTINATION)
  })

  it('never writes the destination itself', async () => {
    await saver().save(BYTES, 'resume.pdf')

    expect(writeFile).not.toHaveBeenCalledWith(DESTINATION, expect.anything())
  })

  it('asks the native shell for the destination directory before writing', async () => {
    await saver().save(BYTES, 'resume.pdf')

    expect(invoke).toHaveBeenCalledWith('allow_export_directory', { destination: DESTINATION })
    // The grant has to be in place before the temporary file is written: the
    // dialog granted the destination, not the sibling the export writes to.
    expect(vi.mocked(invoke).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(writeFile).mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    )
  })

  it('reports nothing when the user dismisses the dialog', async () => {
    vi.mocked(save).mockResolvedValue(null)

    expect(await saver().save(BYTES, 'resume.pdf')).toBeNull()
    expect(writeFile).not.toHaveBeenCalled()
  })

  it('removes the temporary file when the write fails, and leaves the destination alone', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full'))

    await expect(saver().save(BYTES, 'resume.pdf')).rejects.toThrow('disk full')

    expect(remove).toHaveBeenCalledWith(TEMPORARY)
    expect(rename).not.toHaveBeenCalled()
  })

  it('removes the temporary file when the rename fails', async () => {
    vi.mocked(rename).mockRejectedValue(new Error('the destination is open'))

    await expect(saver().save(BYTES, 'resume.pdf')).rejects.toThrow(
      'the destination is open',
    )

    expect(remove).toHaveBeenCalledWith(TEMPORARY)
  })

  it('does not remove a temporary file that was never created', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('permission denied'))
    vi.mocked(exists).mockResolvedValue(false)

    await expect(saver().save(BYTES, 'resume.pdf')).rejects.toThrow('permission denied')

    expect(remove).not.toHaveBeenCalled()
  })

  it('reports a leftover temporary file when the cleanup fails', async () => {
    vi.mocked(writeFile).mockRejectedValue(new Error('disk full'))
    vi.mocked(remove).mockRejectedValue(new Error('the file is open'))

    await expect(saver().save(BYTES, 'resume.pdf')).rejects.toThrow(/could not be removed/)
  })
})
