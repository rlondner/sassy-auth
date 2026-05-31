import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PermissionEditDrawer } from '../permission-edit-drawer'
import type { PermissionRow } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/app/(admin)/permissions/actions', () => ({
  updatePermissionAction: jest.fn().mockResolvedValue({ permission: { publicId: 'sq_p1', name: 'apps.list', app: { publicId: 'sq_a1', name: 'Portal' }, roleCount: 0, userCount: 0 } }),
}))

const permission: PermissionRow = {
  publicId: 'sq_p1', name: 'apps.read',
  app: { publicId: 'sq_a1', name: 'Portal' },
  roleCount: 0, userCount: 0,
}

describe('PermissionEditDrawer', () => {
  it('renders name and read-only app', () => {
    render(<PermissionEditDrawer permission={permission} open={true} onOpenChange={() => {}} />)
    expect(screen.getByDisplayValue('apps.read')).toBeInTheDocument()
    expect(screen.getByText('Portal')).toBeInTheDocument()
    expect(screen.getByText('permissions.fields.appImmutable')).toBeInTheDocument()
  })

  it('Save is disabled until the name is edited', () => {
    render(<PermissionEditDrawer permission={permission} open={true} onOpenChange={() => {}} />)
    const save = screen.getByRole('button', { name: 'permissions.drawer.save' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByDisplayValue('apps.read'), { target: { value: 'apps.list' } })
    expect(save).not.toBeDisabled()
  })

  it('submits with valid name and closes on success', async () => {
    const onOpenChange = jest.fn()
    render(<PermissionEditDrawer permission={permission} open={true} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByDisplayValue('apps.read'), { target: { value: 'apps.list' } })
    fireEvent.click(screen.getByRole('button', { name: 'permissions.drawer.save' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
