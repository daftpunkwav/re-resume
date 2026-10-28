/**
 * @file clipboard
 * @description Clipboard writes that report whether they happened. The WebView
 * can refuse the permission, so callers show a failure instead of a false
 * confirmation.
 */

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || navigator.clipboard === undefined) return false
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
