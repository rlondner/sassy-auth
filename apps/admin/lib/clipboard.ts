'use client'

export async function copyToClipboard(text: string, onCopied?: () => void): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    onCopied?.()
    return true
  } catch {
    return false
  }
}
