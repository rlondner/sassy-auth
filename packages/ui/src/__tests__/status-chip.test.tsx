import { render, screen } from '@testing-library/react'
import { StatusChip } from '../components/status-chip'

describe('StatusChip', () => {
  it('renders active variant with correct label and palette class', () => {
    render(<StatusChip variant="active" label="Active" />)
    const el = screen.getByText('Active').closest('span')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('bg-green-100')
    expect(el).toHaveClass('text-green-800')
  })

  it('renders pending variant', () => {
    render(<StatusChip variant="pending" label="Pending" />)
    const el = screen.getByText('Pending').closest('span')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('bg-amber-100')
  })

  it('renders inactive variant', () => {
    render(<StatusChip variant="inactive" label="Inactive" />)
    const el = screen.getByText('Inactive').closest('span')
    expect(el).toBeInTheDocument()
    expect(el).toHaveClass('bg-slate-100')
  })
})
