import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { UserCreateDrawer } from '../user-create-drawer'
import type { Org } from '@/lib/types'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

// Radix Select is awkward to drive in JSDOM (it relies on pointer events that
// JSDOM does not implement). Swap it for a thin native <select> shim so the
// test can call fireEvent.change to pick an org. Other primitives are
// re-exported from the real package.
jest.mock('@sassy-auth/ui', () => {
  const actual = jest.requireActual('@sassy-auth/ui')
  type ChildrenProps = { children?: React.ReactNode }
  type SelectProps = ChildrenProps & {
    value?: string
    onValueChange?: (value: string) => void
  }
  type SelectItemProps = ChildrenProps & { value: string }
  type SelectValueProps = { placeholder?: string }
  const SelectContext = React.createContext<{
    value: string
    onValueChange: (value: string) => void
    placeholder: string
  }>({ value: '', onValueChange: () => undefined, placeholder: '' })

  function Select({ value = '', onValueChange = () => undefined, children }: SelectProps) {
    const [placeholder, setPlaceholder] = React.useState('')
    return (
      <SelectContext.Provider value={{ value, onValueChange, placeholder }}>
        <select
          aria-label={placeholder || 'select'}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
        >
          <option value="" disabled>{placeholder || 'Select'}</option>
          {React.Children.toArray(children).flatMap((child) => {
            if (!React.isValidElement(child)) return []
            // <SelectContent> wraps the items.
            const grandchildren = (child.props as ChildrenProps).children
            return React.Children.toArray(grandchildren)
          })}
        </select>
        {/* render hidden helpers so SelectValue can set the placeholder via effect */}
        <div hidden>{children}</div>
        <SelectPlaceholderSink onPlaceholder={setPlaceholder}>{children}</SelectPlaceholderSink>
      </SelectContext.Provider>
    )
  }

  function SelectPlaceholderSink({
    children,
    onPlaceholder,
  }: {
    children?: React.ReactNode
    onPlaceholder: (value: string) => void
  }) {
    React.useEffect(() => {
      let found = ''
      const walk = (nodes: React.ReactNode) => {
        React.Children.forEach(nodes, (node) => {
          if (!React.isValidElement(node)) return
          const props = node.props as Record<string, unknown> | undefined
          if (props && typeof props.placeholder === 'string') {
            found = props.placeholder
          }
          if (props && props.children) walk(props.children as React.ReactNode)
        })
      }
      walk(children)
      onPlaceholder(found)
    }, [children, onPlaceholder])
    return null
  }

  function SelectTrigger({ children }: ChildrenProps) {
    return <>{children}</>
  }
  function SelectContent({ children }: ChildrenProps) {
    return <>{children}</>
  }
  function SelectValue(_props: SelectValueProps) {
    return null
  }
  function SelectItem({ value, children }: SelectItemProps) {
    return <option value={value}>{children}</option>
  }

  const Passthrough = ({ children }: { children?: React.ReactNode }) => <>{children}</>
  const Trigger = ({ children, asChild: _asChild, ...rest }: { children?: React.ReactNode; asChild?: boolean }) =>
    React.isValidElement(children) ? React.cloneElement(children, rest as object) : <>{children}</>

  return {
    ...actual,
    Select,
    SelectTrigger,
    SelectContent,
    SelectValue,
    SelectItem,
    Tooltip: Passthrough,
    TooltipTrigger: Trigger,
    TooltipContent: Passthrough,
  }
})

jest.mock('@/app/(admin)/users/actions', () => ({
  createUserAction: jest.fn(),
  getRolesAction: jest.fn().mockResolvedValue([
    { publicId: 'role-a', name: 'Role A', appId: 'app-1' },
  ]),
  getAppPermissionsAction: jest.fn().mockResolvedValue([
    { publicId: 'perm-a', name: 'apps.read' },
  ]),
}))

const mockOrgs: Org[] = [{ id: 'org1', name: 'Acme Corp', appId: 'app1', isPlatform: true }]

describe('UserCreateDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('renders form fields when open', () => {
    render(<UserCreateDrawer orgs={mockOrgs} open={true} onOpenChange={() => {}} />)
    expect(screen.getByText('users.drawer.basicInfo')).toBeInTheDocument()
    expect(screen.getByText('users.drawer.accessPerms')).toBeInTheDocument()
  })

  it('passes roleIds + directPermissionIds when submitting', async () => {
    const actions = jest.requireMock('@/app/(admin)/users/actions')
    actions.createUserAction.mockResolvedValue({ inviteUrl: 'https://example.com/i' })

    render(
      <UserCreateDrawer
        orgs={[{ id: 'org-1', name: 'Org One', appId: 'app-1', isPlatform: false }]}
        open
        onOpenChange={() => {}}
      />,
    )

    // Fill required fields. FormField renders required fields as
    // "<label>key<span>*</span></label>" so the label's full text is "key*".
    // Match on a prefix regex to ignore the trailing asterisk.
    fireEvent.change(screen.getByLabelText(/^users\.fields\.firstName/), { target: { value: 'A' } })
    fireEvent.change(screen.getByLabelText(/^users\.fields\.lastName/), { target: { value: 'B' } })
    fireEvent.change(screen.getByLabelText(/^users\.fields\.email/), { target: { value: 'a@b.io' } })

    // Pick org via the mocked native <select> (placeholder "Select org").
    fireEvent.change(screen.getByLabelText('Select org'), { target: { value: 'org-1' } })

    // Wait for getRolesAction + getAppPermissionsAction to settle so the role
    // and permission row editors leave their loading states.
    await waitFor(() => expect(actions.getRolesAction).toHaveBeenCalledWith('app-1'))
    await waitFor(() => expect(actions.getAppPermissionsAction).toHaveBeenCalledWith('app-1'))

    // Add a role row + select role
    fireEvent.click(await screen.findByRole('button', { name: /users\.fields\.addRole/ }))
    fireEvent.change(await screen.findByLabelText('users.fields.roleRow'), { target: { value: 'role-a' } })

    // Add a direct-permission row + select permission
    fireEvent.click(screen.getByRole('button', { name: /roles\.fields\.addPermission/ }))
    fireEvent.change(screen.getByLabelText('roles.fields.permissionRow'), { target: { value: 'perm-a' } })

    // Submit
    fireEvent.click(screen.getByRole('button', { name: 'users.drawer.create' }))

    await waitFor(() => {
      expect(actions.createUserAction).toHaveBeenCalledWith(
        expect.objectContaining({
          firstName: 'A',
          lastName: 'B',
          email: 'a@b.io',
          orgId: 'org-1',
          roleIds: ['role-a'],
          directPermissionIds: ['perm-a'],
        }),
      )
    })
  })
})
