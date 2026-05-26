import { render, screen } from '@testing-library/react'
import { StatusChip } from '../components/status-chip'

describe('StatusChip', () => {
  it('renders active variant with correct label', () => {
    render(<StatusChip variant="active" label="Active" />)
    expect(screen.getByText('Active')).toBeInTheDocument()
    const el = screen.getByText('Active').closest('span')
    expect(el).toHaveStyle({ backgroundColor: '#dce9ff', color: '#3525cd' })
  })

  it('renders pending variant', () => {
    render(<StatusChip variant="pending" label="Pending" />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
  })

  it('renders inactive variant', () => {
    render(<StatusChip variant="inactive" label="Inactive" />)
    expect(screen.getByText('Inactive')).toBeInTheDocument()
  })
})
