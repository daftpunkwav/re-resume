/**
 * @file PdfFileSaver
 * @description The platform capability of handing exported PDF bytes to the
 * user: ask where to write them and write them there. Declared in the domain
 * because the application export flow depends on it and application may only
 * depend on domain types.
 *
 * Constraints:
 * - The implementation owns the dialog and the file write; callers hand over
 *   bytes and a suggested file name and learn where the file landed.
 * - Saving is user-initiated and cancellable: a dismissed dialog is a null
 *   path, not an error.
 */

export interface PdfFileSaver {
  /**
   * Asks the user where to write the bytes and writes them. Returns the path
   * written, or null when the user dismissed the dialog.
   */
  save(bytes: Uint8Array, suggestedName: string): Promise<string | null>
}
