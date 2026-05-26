import { render, screen } from '@testing-library/react'
import { StatusChip } from '../components/status-chip'

describe('StatusChip', () => {
  it('renders active variant with correct label and background', () => {
    render(<StatusChip variant="active" label="Active" />)
    const el = screen.getByText('Active').closest('span')
    expect(el).toBeInTheDocument()
    expect(el).toHaveStyle({ backgroundColor: '#dce9ff' })
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
