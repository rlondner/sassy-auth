import * as React from 'react'
import { render, screen } from '@testing-library/react'
import { Button } from '../components/button'

describe('Button', () => {
  it('renders correctly', () => {
    render(<Button>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeInTheDocument()
  })

  it('renders loading state with spinner', () => {
    render(<Button loading>Click me</Button>)
    const button = screen.getByRole('button', { name: /Click me/ })
    expect(button).toBeDisabled()
    expect(screen.getByText('progress_activity')).toBeInTheDocument()
  })

  it('is disabled when disabled prop is true', () => {
    render(<Button disabled>Click me</Button>)
    expect(screen.getByRole('button', { name: 'Click me' })).toBeDisabled()
  })

  it('maintains children when loading', () => {
    render(<Button loading>Save</Button>)
    expect(screen.getByText('Save')).toBeInTheDocument()
  })
})
