import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserCreateDrawer } from '../user-create-drawer'
import type { Org } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

jest.mock('@/app/(admin)/users/actions', () => ({
  createUserAction: jest.fn().mockResolvedValue({ inviteUrl: 'http://localhost:3001/accept-invite?token=abc123' }),
}))

jest.mock('@/lib/api', () => ({
  getRoles: jest.fn().mockResolvedValue([{ id: 'r1', name: 'admin', appId: 'app1' }]),
}))

const mockOrgs: Org[] = [{ id: 'org1', name: 'Acme Corp', appId: 'app1', isPlatform: true }]

describe('UserCreateDrawer', () => {
  it('renders form fields when open', () => {
    render(<UserCreateDrawer orgs={mockOrgs} open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('users.drawer.basicInfo')).toBeInTheDocument()
    expect(screen.getByText('users.drawer.accessPerms')).toBeInTheDocument()
  })
})
