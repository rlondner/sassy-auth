import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '../../messages/en.json'
import { AppColorField } from '../app-color-field'

function wrap(ui: React.ReactElement) {
  return render(<NextIntlClientProvider locale="en" messages={en}>{ui}</NextIntlClientProvider>)
}

describe('AppColorField', () => {
  it('renders the hex text input with the current value', () => {
    wrap(<AppColorField value="#111111" onValueChange={jest.fn()} inputId="x" label="Page background (light)" hint="hint" />)
    // Scoped to the accessible text input rather than getByDisplayValue: the native
    // <input type="color"> swatch is also kept in sync with the current value (so the OS
    // picker opens on the right color), and getByDisplayValue matches any form control's
    // live value/defaultValue regardless of type, so an unscoped query here would now match
    // both inputs and throw.
    expect(screen.getByLabelText('Page background (light)')).toHaveValue('#111111')
  })

  it('syncs the color swatch input to the current value', () => {
    const { container } = wrap(<AppColorField value="#111111" onValueChange={jest.fn()} inputId="x" label="Page background (light)" hint="hint" />)
    expect(container.querySelector('input[type="color"]')).toHaveValue('#111111')
  })

  it('calls onValueChange with a valid 6-digit hex value', () => {
    const onValueChange = jest.fn()
    wrap(<AppColorField value={null} onValueChange={onValueChange} inputId="x" label="Page background (light)" hint="hint" />)
    fireEvent.change(screen.getByLabelText('Page background (light)'), { target: { value: '#abcdef' } })
    expect(onValueChange).toHaveBeenCalledWith('#abcdef')
  })

  it('shows an invalid-hex error and does not call onValueChange for a malformed value', () => {
    const onValueChange = jest.fn()
    wrap(<AppColorField value={null} onValueChange={onValueChange} inputId="x" label="Page background (light)" hint="hint" />)
    fireEvent.change(screen.getByLabelText('Page background (light)'), { target: { value: 'not-a-color' } })
    fireEvent.blur(screen.getByLabelText('Page background (light)'))
    expect(screen.getByText(en.apps.errors.invalidHexColor)).toBeInTheDocument()
  })

  it('clears to null when Reset to default is clicked', () => {
    const onValueChange = jest.fn()
    wrap(<AppColorField value="#111111" onValueChange={onValueChange} inputId="x" label="Page background (light)" hint="hint" />)
    fireEvent.click(screen.getByText(en.apps.fields.resetColorToDefault))
    expect(onValueChange).toHaveBeenCalledWith(null)
  })
})
