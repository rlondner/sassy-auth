import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { OtpInput } from '../components/otp-input'

function ControlledOtpInput({ value: initialValue, ...rest }: Partial<React.ComponentProps<typeof OtpInput>>) {
  const [value, setValue] = React.useState(initialValue ?? '')
  return <OtpInput length={6} label="Enter code" {...rest} value={value} onChange={setValue} />
}

describe('OtpInput', () => {
  it('renders one box per digit, defaulting to 6', () => {
    render(<ControlledOtpInput />)
    expect(screen.getAllByRole('textbox')).toHaveLength(6)
  })

  it('types a single digit into an empty box and advances focus to the next box', () => {
    render(<ControlledOtpInput />)
    const boxes = screen.getAllByRole('textbox')
    fireEvent.change(boxes[0], { target: { value: '1' } })
    expect(boxes[0]).toHaveValue('1')
    expect(boxes[1]).toHaveFocus()
  })

  it('retyping over an already-filled box still replaces the digit and advances focus', () => {
    // Regression test: the box already holding a digit (e.g. from a
    // previously-rejected code) must not block the keystroke or strand
    // focus — this used to require clearing the box first.
    render(<ControlledOtpInput value="123456" />)
    const boxes = screen.getAllByRole('textbox')
    fireEvent.change(boxes[0], { target: { value: '19' } }) // browser appends at cursor: old "1" + typed "9"
    expect(boxes[0]).toHaveValue('9')
    expect(boxes[1]).toHaveFocus()
  })

  it('moves focus back and clears the previous box on backspace from an empty box', () => {
    render(<ControlledOtpInput value="12" />)
    const boxes = screen.getAllByRole('textbox')
    boxes[2].focus()
    fireEvent.keyDown(boxes[2], { key: 'Backspace' })
    expect(boxes[1]).toHaveFocus()
  })

  it('distributes a multi-character paste across the remaining boxes', () => {
    render(<ControlledOtpInput />)
    const boxes = screen.getAllByRole('textbox')
    fireEvent.paste(boxes[0], { clipboardData: { getData: () => '123456' } })
    boxes.forEach((box, i) => expect(box).toHaveValue(String(i + 1)))
  })

  it('strips non-digit characters from pasted input', () => {
    render(<ControlledOtpInput />)
    const boxes = screen.getAllByRole('textbox')
    fireEvent.paste(boxes[0], { clipboardData: { getData: () => 'a1b2c3' } })
    expect(boxes.map((b) => (b as HTMLInputElement).value).join('')).toBe('123')
  })

  it('applies the data-testid to the first box only', () => {
    render(<ControlledOtpInput data-testid="otp" />)
    expect(screen.getByTestId('otp')).toBe(screen.getAllByRole('textbox')[0])
  })

  it('shows the error message and marks every box invalid', () => {
    render(<ControlledOtpInput error="That code isn't right." />)
    expect(screen.getByText("That code isn't right.")).toBeInTheDocument()
    screen.getAllByRole('textbox').forEach((box) => expect(box).toHaveAttribute('aria-invalid', 'true'))
  })
})
