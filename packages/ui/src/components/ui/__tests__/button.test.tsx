import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Button } from '../button'

describe('Button', () => {
  it('renders children', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('shows loader and is disabled when loading', () => {
    const { container } = render(<Button loading>Click me</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    // Check for the presence of the svg (Loader2)
    const svg = container.querySelector('svg')
    expect(svg).toBeInTheDocument()
    expect(svg).toHaveClass('animate-spin')
  })

  it('does not show loader when asChild is true even if loading is true', () => {
    const { container } = render(
      <Button asChild loading>
        <a href="/">Click me</a>
      </Button>
    )
    const link = screen.getByRole('link', { name: 'Click me' })
    expect(link).toBeInTheDocument()
    // It should still be disabled because we passed disabled down to Comp (Slot)
    // Though for 'a' tag disabled doesn't do much natively without extra handling,
    // but the prop is passed.
    const svg = container.querySelector('svg')
    expect(svg).not.toBeInTheDocument()
  })
})
