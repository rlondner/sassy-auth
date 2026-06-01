import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Button } from '../components/ui/button'

describe('Button', () => {
  it('renders children correctly', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeInTheDocument()
  })

  it('shows loading spinner when loading prop is true', () => {
    render(<Button loading>Click me</Button>)
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(screen.getByText('progress_activity')).toBeInTheDocument()
    expect(screen.getByText('progress_activity')).toHaveClass('animate-spin')
  })

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeDisabled()
  })

  it('can be disabled even if not loading', () => {
    render(<Button disabled loading={false}>Click me</Button>)
    expect(screen.getByRole('button', { name: /click me/i })).toBeDisabled()
    expect(screen.queryByText('progress_activity')).not.toBeInTheDocument()
  })
})
