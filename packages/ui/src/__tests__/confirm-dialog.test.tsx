import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { ConfirmDialog } from '../components/confirm-dialog'

function Harness({ onConfirm }: { onConfirm?: () => Promise<void> | void }) {
  const [open, setOpen] = React.useState(true)
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={setOpen}
      title="Delete app"
      description="Delete Customer Portal? This cannot be undone."
      confirmLabel="Delete"
      cancelLabel="Cancel"
      variant="destructive"
      onConfirm={onConfirm ?? (() => undefined)}
    />
  )
}

describe('ConfirmDialog', () => {
  it('renders title, description, and labels', () => {
    render(<Harness />)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
    expect(screen.getByText('Delete app')).toBeInTheDocument()
    expect(screen.getByText(/Delete Customer Portal/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('disables the confirm button while onConfirm is pending', async () => {
    let resolve!: () => void
    const onConfirm = jest.fn(() => new Promise<void>((r) => { resolve = r }))
    render(<Harness onConfirm={onConfirm} />)
    const confirm = screen.getByRole('button', { name: 'Delete' })
    fireEvent.click(confirm)
    await waitFor(() => expect(confirm).toBeDisabled())
    resolve()
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1))
  })

  it('stays open and surfaces error when onConfirm throws', async () => {
    const onConfirm = jest.fn().mockRejectedValue(new Error('Boom'))
    render(<Harness onConfirm={onConfirm} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(screen.getByText(/Boom/)).toBeInTheDocument())
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })

  it('closes on Cancel', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
  })

  it('does not dismiss on outside click (Radix AlertDialog default)', async () => {
    render(<Harness />)
    fireEvent.pointerDown(document.body)
    fireEvent.mouseDown(document.body)
    expect(screen.getByRole('alertdialog')).toBeInTheDocument()
  })
})
