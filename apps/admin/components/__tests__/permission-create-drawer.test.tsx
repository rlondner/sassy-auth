import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { PermissionCreateDrawer } from '../permission-create-drawer'
import type { App } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/app/(admin)/permissions/actions', () => ({
  createPermissionAction: jest.fn().mockResolvedValue({ permission: { publicId: 'sq_p1', name: 'apps.read', app: { publicId: 'sq_a1', name: 'Portal' }, roleCount: 0, userCount: 0 } }),
}))

const apps: App[] = [
  { publicId: 'sq_a1', name: 'Customer Portal', url: 'https://portal.example.com', isPlatform: false },
]

describe('PermissionCreateDrawer', () => {
  it('renders form fields when open', () => {
    render(<PermissionCreateDrawer apps={apps} open={true} onOpenChange={() => {}} />)
    expect(screen.getByLabelText('permissions.fields.app')).toBeInTheDocument()
    expect(screen.getByLabelText('permissions.fields.name')).toBeInTheDocument()
  })

  it('surfaces nameInvalid for a non-dotted name', async () => {
    const { createPermissionAction } = jest.requireMock('@/app/(admin)/permissions/actions')
    render(<PermissionCreateDrawer apps={apps} open={true} onOpenChange={() => {}} />)
    fireEvent.change(screen.getByLabelText('permissions.fields.app'), { target: { value: 'sq_a1' } })
    fireEvent.change(screen.getByLabelText('permissions.fields.name'), { target: { value: 'bogus' } })
    fireEvent.click(screen.getByRole('button', { name: 'permissions.drawer.createTitle' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('permissions.errors.nameInvalid'))
    expect(createPermissionAction).not.toHaveBeenCalled()
  })

  it('submits with valid input and closes drawer on success', async () => {
    const onOpenChange = jest.fn()
    render(<PermissionCreateDrawer apps={apps} open={true} onOpenChange={onOpenChange} />)
    fireEvent.change(screen.getByLabelText('permissions.fields.app'), { target: { value: 'sq_a1' } })
    fireEvent.change(screen.getByLabelText('permissions.fields.name'), { target: { value: 'apps.read' } })
    fireEvent.click(screen.getByRole('button', { name: 'permissions.drawer.createTitle' }))
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
