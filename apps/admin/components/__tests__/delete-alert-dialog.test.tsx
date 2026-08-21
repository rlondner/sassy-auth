import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { DeleteAlertDialog } from '../delete-alert-dialog'

describe('DeleteAlertDialog', () => {
  const defaultProps = {
    open: true,
    onOpenChange: jest.fn(),
    title: 'Delete App',
    description: 'Are you sure you want to delete this app?',
    confirmLabel: 'Delete',
    cancelLabel: 'Cancel',
    onConfirm: jest.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('renders title, description, and action buttons when open', () => {
    render(<DeleteAlertDialog {...defaultProps} />)
    expect(screen.getByText('Delete App')).toBeInTheDocument()
    expect(
      screen.getByText('Are you sure you want to delete this app?')
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('renders alert message with role="alert" when error prop is provided', () => {
    render(
      <DeleteAlertDialog {...defaultProps} error="Failed to delete resource" />
    )
    const alertElement = screen.getByRole('alert')
    expect(alertElement).toBeInTheDocument()
    expect(alertElement).toHaveTextContent('Failed to delete resource')
    expect(alertElement).toHaveAttribute('aria-live', 'assertive')
  })

  it('triggers onConfirm callback when confirm button is clicked', async () => {
    render(<DeleteAlertDialog {...defaultProps} />)
    const confirmButton = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(confirmButton)

    await waitFor(() => {
      expect(defaultProps.onConfirm).toHaveBeenCalledTimes(1)
    })
  })
})
