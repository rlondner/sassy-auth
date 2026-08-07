import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { ShareLinkDialog } from '../share-link-dialog'

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('ShareLinkDialog', () => {
  it('renders input with correct URL, focus-visible classes, and auto-selects text on focus or click', () => {
    const onOpenChange = jest.fn()
    const url = 'https://example.com/invite'

    render(
      withIntl(
        <ShareLinkDialog
          open
          onOpenChange={onOpenChange}
          title="Invite Link"
          description="Copy and share this link."
          url={url}
        />
      )
    )

    // Check title and description
    expect(screen.getByText('Invite Link')).toBeInTheDocument()
    expect(screen.getByText('Copy and share this link.')).toBeInTheDocument()

    // Get input and check value and attributes
    const input = screen.getByLabelText('Invite Link', { selector: 'input' }) as HTMLInputElement
    expect(input.value).toBe(url)
    expect(input.readOnly).toBe(true)

    // Verify focus-visible style classes exist
    const className = input.className
    expect(className).toContain('focus-visible:outline-none')
    expect(className).toContain('focus-visible:ring-2')
    expect(className).toContain('focus-visible:ring-ring')
    expect(className).toContain('focus-visible:ring-offset-2')

    // Initially nothing selected or JSDOM default
    input.selectionStart = 0
    input.selectionEnd = 0

    // Trigger Focus -> should select all text
    fireEvent.focus(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(url.length)

    // Reset selection
    input.selectionStart = 0
    input.selectionEnd = 0

    // Trigger Click -> should select all text
    fireEvent.click(input)
    expect(input.selectionStart).toBe(0)
    expect(input.selectionEnd).toBe(url.length)
  })
})
