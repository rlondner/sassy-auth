import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from '../collapsible-section'

describe('CollapsibleSection', () => {
  it('renders children when open', () => {
    render(
      <CollapsibleSection title="Branding" open onOpenChange={() => undefined}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('Logo field')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Branding' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides children when closed', () => {
    render(
      <CollapsibleSection title="Branding" open={false} onOpenChange={() => undefined}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    expect(screen.queryByText('Logo field')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Branding' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('calls onOpenChange with the toggled value when the header is clicked', () => {
    const onOpenChange = jest.fn()
    render(
      <CollapsibleSection title="Branding" open={false} onOpenChange={onOpenChange}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Branding' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('calls onOpenChange on Enter and Space keypresses', () => {
    const onOpenChange = jest.fn()
    render(
      <CollapsibleSection title="Branding" open onOpenChange={onOpenChange}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    const trigger = screen.getByRole('button', { name: 'Branding' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
