import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppLogoField } from '../app-logo-field'

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('AppLogoField', () => {
  it('converts a valid small image to a data URI and calls onValueChange', async () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppLogoField value={null} onValueChange={onValueChange} />))
    const file = new File(['a'.repeat(10)], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.logo), { target: { files: [file] } })
    await waitFor(() => expect(onValueChange).toHaveBeenCalledWith(expect.stringMatching(/^data:image\/png;base64,/)))
  })

  it('rejects a disallowed file type without calling onValueChange', async () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppLogoField value={null} onValueChange={onValueChange} />))
    const file = new File(['a'.repeat(10)], 'logo.gif', { type: 'image/gif' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.logo), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByText(en.apps.errors.logoInvalidType)).toBeInTheDocument())
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('rejects a file over the size cap without calling onValueChange', async () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppLogoField value={null} onValueChange={onValueChange} />))
    const oversized = new File([new Uint8Array(260 * 1024)], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.logo), { target: { files: [oversized] } })
    await waitFor(() => expect(screen.getByText(en.apps.errors.logoTooLarge)).toBeInTheDocument())
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('shows a preview and a remove button when a value is set, and clears on remove', () => {
    const onValueChange = jest.fn()
    render(withIntl(<AppLogoField value="data:image/png;base64,AAA=" onValueChange={onValueChange} />))
    expect(screen.getByRole('img')).toHaveAttribute('src', 'data:image/png;base64,AAA=')
    fireEvent.click(screen.getByRole('button', { name: en.apps.fields.removeLogo }))
    expect(onValueChange).toHaveBeenCalledWith(null)
  })

  it('shows no preview or remove button when value is null', () => {
    render(withIntl(<AppLogoField value={null} onValueChange={jest.fn()} />))
    expect(screen.queryByRole('img')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: en.apps.fields.removeLogo })).not.toBeInTheDocument()
  })
})
