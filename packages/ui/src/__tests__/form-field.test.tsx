import { render, screen } from '@testing-library/react'
import { FormField } from '../components/form-field'

describe('FormField', () => {
  it('renders the label and links it to the input via a generated id', () => {
    render(<FormField label="Name" />)
    const input = screen.getByLabelText('Name')
    expect(input).toBeInTheDocument()
    expect(input).not.toHaveAttribute('aria-describedby')
    expect(input).toHaveAttribute('aria-invalid', 'false')
  })

  it('uses the supplied id instead of the generated one', () => {
    render(<FormField label="Email" id="email-field" />)
    expect(screen.getByLabelText('Email')).toHaveAttribute('id', 'email-field')
  })

  it('renders a required marker when required is set', () => {
    render(<FormField label="Name" required />)
    expect(screen.getByText('*')).toBeInTheDocument()
  })

  it('does not render a required marker by default', () => {
    render(<FormField label="Name" />)
    expect(screen.queryByText('*')).not.toBeInTheDocument()
  })

  it('shows the hint and links it via aria-describedby when there is no error', () => {
    render(<FormField label="Name" hint="Your full legal name" />)
    const input = screen.getByLabelText('Name')
    expect(screen.getByText('Your full legal name')).toBeInTheDocument()
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent('Your full legal name')
  })

  it('shows the error, marks aria-invalid, and hides the hint when both are present', () => {
    render(<FormField label="Name" hint="Your full legal name" error="Name is required" />)
    const input = screen.getByLabelText('Name')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByText('Name is required')).toBeInTheDocument()
    expect(screen.queryByText('Your full legal name')).not.toBeInTheDocument()
    const describedBy = input.getAttribute('aria-describedby')
    expect(document.getElementById(describedBy as string)).toHaveTextContent('Name is required')
  })
})
