import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Button } from '../button'

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('shows loader and disables when loading is true', () => {
    const { container } = render(<Button loading>Click me</Button>)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')

    // Check for the presence of the Loader2 icon (it has the animate-spin class)
    const loader = container.querySelector('.animate-spin')
    expect(loader).toBeInTheDocument()
    expect(screen.getByText('Click me')).toBeInTheDocument()
  })

  it('does not show loader when loading is false', () => {
    const { container } = render(<Button loading={false}>Click me</Button>)

    const button = screen.getByRole('button')
    expect(button).not.toBeDisabled()
    expect(button).not.toHaveAttribute('aria-busy')

    const loader = container.querySelector('.animate-spin')
    expect(loader).not.toBeInTheDocument()
  })

  it('does not render loader when asChild is true even if loading is true', () => {
    const { container } = render(
      <Button loading asChild>
        <a href="/">Click me</a>
      </Button>
    )

    const loader = container.querySelector('.animate-spin')
    expect(loader).not.toBeInTheDocument()
    // Radix Slot should still apply the disabled prop (though <a> doesn't support it natively, it should be there)
    const link = screen.getByRole('link')
    expect(link).toHaveAttribute('aria-busy', 'true')
  })
})
