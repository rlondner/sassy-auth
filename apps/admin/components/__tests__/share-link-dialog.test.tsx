import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { ShareLinkDialog } from '../share-link-dialog'
import * as clipboard from '@/lib/clipboard'

jest.mock('@/lib/clipboard', () => ({
  copyToClipboard: jest.fn(),
}))

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('ShareLinkDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders title, description, and read-only URL input', () => {
    render(
      withIntl(
        <ShareLinkDialog
          open
          onOpenChange={jest.fn()}
          title="Share Link"
          description="Copy the link below to share access."
          url="https://example.com/share/123"
        />,
      ),
    )

    expect(screen.getByText('Share Link')).toBeInTheDocument()
    expect(screen.getByText('Copy the link below to share access.')).toBeInTheDocument()

    const input = screen.getByRole('textbox', { name: 'Share Link' }) as HTMLInputElement
    expect(input).toBeInTheDocument()
    expect(input.value).toBe('https://example.com/share/123')
    expect(input).toHaveAttribute('readOnly')
  })

  it('copies URL and shows feedback on button click', async () => {
    ;(clipboard.copyToClipboard as jest.Mock).mockResolvedValue(true)

    render(
      withIntl(
        <ShareLinkDialog
          open
          onOpenChange={jest.fn()}
          title="Share Link"
          description="Copy the link below to share access."
          url="https://example.com/share/123"
        />,
      ),
    )

    const copyBtn = screen.getByRole('button', { name: en.users.drawer.copyLink })
    fireEvent.click(copyBtn)

    await waitFor(() => {
      expect(clipboard.copyToClipboard).toHaveBeenCalledWith('https://example.com/share/123')
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: en.users.drawer.copied })).toBeInTheDocument()
    })
  })
})
