import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppEditDrawer } from '../app-edit-drawer'
import * as actions from '@/app/(admin)/apps/actions'
import * as orgsActions from '@/app/(admin)/orgs/actions'
import * as rolesActions from '@/app/(admin)/roles/actions'

jest.mock('@/app/(admin)/apps/actions', () => ({
  updateAppAction: jest.fn(),
  getSocialProviderSettingsAction: jest.fn(),
  updateSocialProvidersAction: jest.fn(),
  rotateClientSecretAction: jest.fn(),
}))
jest.mock('@/app/(admin)/orgs/actions', () => ({
  listOrgsAction: jest.fn(),
}))
jest.mock('@/app/(admin)/roles/actions', () => ({
  listRolesAction: jest.fn(),
}))

// Radix Select is awkward to drive in JSDOM (it relies on pointer events that
// JSDOM does not implement). Swap it for a thin native <select> shim so tests
// can call fireEvent.change to pick an org/role. Other primitives are
// re-exported from the real package. Mirrors the shim in
// user-create-drawer.test.tsx.
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

  return {
    ...actual,
    Select,
    SelectTrigger,
    SelectContent,
    SelectValue,
    SelectItem,
  }
})

Object.assign(navigator, { clipboard: { writeText: jest.fn().mockResolvedValue(undefined) } })

const app = { publicId: 'sq_1', name: 'Old', url: 'https://old.example', isPlatform: false, requireTwoFactor: false }

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('AppEditDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    ;(actions.getSocialProviderSettingsAction as jest.Mock).mockResolvedValue({ available: [], enabled: [] })
    ;(orgsActions.listOrgsAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 })
    ;(rolesActions.listRolesAction as jest.Mock).mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 200 })
  })

  it('renders the publicId as read-only and copies on click', async () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    const pubInput = screen.getByDisplayValue('sq_1') as HTMLInputElement
    expect(pubInput.readOnly).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: en.apps.actions.copy }))
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sq_1'))
  })

  it('disables Save when no fields are dirty and enables after edit', () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeDisabled()
    const nameInput = screen.getByLabelText(en.apps.fields.name) as HTMLInputElement
    fireEvent.change(nameInput, { target: { value: 'New' } })
    expect(save).toBeEnabled()
  })

  it('submits patch via updateAppAction', async () => {
    ;(actions.updateAppAction as jest.Mock).mockResolvedValue({
      app: { ...app, name: 'New' },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'New' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.save }))
    await waitFor(() =>
      expect(actions.updateAppAction).toHaveBeenCalledWith('sq_1', { name: 'New' }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  // Task 4: the single callbackUrl input is gone — apps now register a
  // repeatable list of login/post_logout redirect URIs.
  it('shows the no-login-URIs warning when the app has none registered', () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    expect(screen.getByText(en.apps.fields.noLoginUrisWarning)).toBeInTheDocument()
  })

  it('adds a redirect URI row, fills it in, and submits it in the patch', async () => {
    ;(actions.updateAppAction as jest.Mock).mockResolvedValue({
      app: { ...app, redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' }] },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))

    fireEvent.click(screen.getByRole('button', { name: en.apps.fields.addRedirectUri }))
    fireEvent.change(screen.getByLabelText(en.apps.fields.redirectUris), {
      target: { value: 'https://app.example.com/cb' },
    })
    expect(screen.queryByText(en.apps.fields.noLoginUrisWarning)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.save }))
    await waitFor(() =>
      expect(actions.updateAppAction).toHaveBeenCalledWith('sq_1', {
        redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' }],
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('removes a redirect URI row', () => {
    const appWithUri = {
      ...app,
      redirectUris: [{ uri: 'https://app.example.com/cb', kind: 'login' as const }],
    }
    render(withIntl(<AppEditDrawer app={appWithUri} open onOpenChange={() => undefined} />))
    expect(screen.queryByText(en.apps.fields.noLoginUrisWarning)).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: en.apps.fields.removeRedirectUri }))
    expect(screen.getByText(en.apps.fields.noLoginUrisWarning)).toBeInTheDocument()
    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeEnabled()
  })

  it('renders social sign-in checkboxes from the fetched list, checked by default', async () => {
    ;(actions.getSocialProviderSettingsAction as jest.Mock).mockResolvedValue({
      available: ['google', 'microsoft'],
      enabled: ['google', 'microsoft'],
    })
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    await waitFor(() =>
      expect(actions.getSocialProviderSettingsAction).toHaveBeenCalledWith('sq_1'),
    )
    const google = (await screen.findByLabelText(en.apps.fields.socialProviderNames.google)) as HTMLInputElement
    const microsoft = screen.getByLabelText(en.apps.fields.socialProviderNames.microsoft) as HTMLInputElement
    expect(google.checked).toBe(true)
    expect(microsoft.checked).toBe(true)
  })

  // Finding 1: `available` can include providers the app currently has
  // OFF (not present in `enabled`) — that's the opt-in case the public GET
  // /api/social-providers can never support, since it only ever returns
  // the currently-enabled subset. The checkbox must still render, unchecked.
  it('renders an unchecked checkbox for a provider the app has not enabled, allowing opt-in', async () => {
    ;(actions.getSocialProviderSettingsAction as jest.Mock).mockResolvedValue({
      available: ['google', 'microsoft'],
      enabled: ['google'],
    })
    ;(actions.updateSocialProvidersAction as jest.Mock).mockResolvedValue({
      providers: ['google', 'microsoft'],
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))
    const microsoft = (await screen.findByLabelText(en.apps.fields.socialProviderNames.microsoft)) as HTMLInputElement
    expect(microsoft.checked).toBe(false)

    fireEvent.click(microsoft)
    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() =>
      expect(actions.updateSocialProvidersAction).toHaveBeenCalledWith(
        'sq_1',
        expect.arrayContaining(['google', 'microsoft']),
      ),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('unchecking a provider submits a providers array without it', async () => {
    ;(actions.getSocialProviderSettingsAction as jest.Mock).mockResolvedValue({
      available: ['google', 'microsoft'],
      enabled: ['google', 'microsoft'],
    })
    ;(actions.updateSocialProvidersAction as jest.Mock).mockResolvedValue({
      providers: ['google'],
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))
    const microsoft = await screen.findByLabelText(en.apps.fields.socialProviderNames.microsoft)
    fireEvent.click(microsoft)

    const save = screen.getByRole('button', { name: en.apps.drawer.save })
    expect(save).toBeEnabled()
    fireEvent.click(save)

    await waitFor(() =>
      expect(actions.updateSocialProvidersAction).toHaveBeenCalledWith('sq_1', ['google']),
    )
    expect(actions.updateAppAction).not.toHaveBeenCalled()
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  // Finding 4: the component is kept mounted (with `open` toggling) for
  // every selected row in AppsTable, including View and Delete — not just
  // Edit. Before this fix, the fetch fired on mount regardless of `open`,
  // so every row click made an authenticated request whose result was
  // never shown. It must only fire once the drawer is actually open.
  it('does not fetch social-provider settings while the drawer is mounted but closed', async () => {
    render(withIntl(<AppEditDrawer app={app} open={false} onOpenChange={() => undefined} />))
    // Give any stray microtask/effect a chance to run before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(actions.getSocialProviderSettingsAction).not.toHaveBeenCalled()
  })

  it('fetches social-provider settings once the drawer transitions to open', async () => {
    ;(actions.getSocialProviderSettingsAction as jest.Mock).mockResolvedValue({
      available: ['google'],
      enabled: ['google'],
    })
    const { rerender } = render(
      withIntl(<AppEditDrawer app={app} open={false} onOpenChange={() => undefined} />),
    )
    expect(actions.getSocialProviderSettingsAction).not.toHaveBeenCalled()
    rerender(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    await waitFor(() =>
      expect(actions.getSocialProviderSettingsAction).toHaveBeenCalledWith('sq_1'),
    )
  })

  // Task 9: confidential clients — the admin console's client-secret UI.

  it('shows "no client secret" for a public app and a Generate button', () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    expect(screen.getByText(en.apps.fields.noClientSecret)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: en.apps.fields.generateClientSecret }),
    ).toBeInTheDocument()
  })

  it('shows the rotation date and a Regenerate button for a confidential app', () => {
    const confidentialApp = { ...app, isConfidential: true, clientSecretUpdatedAt: '2026-08-01T00:00:00Z' }
    render(withIntl(<AppEditDrawer app={confidentialApp} open onOpenChange={() => undefined} />))
    expect(
      screen.getByRole('button', { name: en.apps.fields.regenerateClientSecret }),
    ).toBeInTheDocument()
    expect(screen.queryByText(en.apps.fields.noClientSecret)).not.toBeInTheDocument()
  })

  it('generating a client secret displays the plaintext once, with a copy control and warning', async () => {
    ;(actions.rotateClientSecretAction as jest.Mock).mockResolvedValue({
      clientSecret: 'plaintext-secret-value',
    })
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))

    fireEvent.click(screen.getByRole('button', { name: en.apps.fields.generateClientSecret }))

    await waitFor(() =>
      expect(actions.rotateClientSecretAction).toHaveBeenCalledWith('sq_1'),
    )
    const secretInput = (await screen.findByDisplayValue(
      'plaintext-secret-value',
    )) as HTMLInputElement
    expect(secretInput.readOnly).toBe(true)
    expect(screen.getByText(en.apps.fields.clientSecretWarning)).toBeInTheDocument()

    // Both the publicId field and the new-secret field render a "Copy"
    // button with the same accessible name; the secret's copy button is
    // the one rendered nearest the secret input.
    const copyButtons = screen.getAllByRole('button', { name: en.apps.actions.copy })
    fireEvent.click(copyButtons[copyButtons.length - 1])
    await waitFor(() =>
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('plaintext-secret-value'),
    )
  })

  // Task 13: default org / default role selects, populated from this app's
  // own orgs/roles.

  it("renders Default organization and Default role selects populated from this app's orgs/roles", async () => {
    ;(orgsActions.listOrgsAction as jest.Mock).mockResolvedValue({
      items: [{ publicId: 'org1', name: 'Citadel', isPlatform: false, userCount: 0, app: { publicId: 'sq_1', name: 'App' } }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    ;(rolesActions.listRolesAction as jest.Mock).mockResolvedValue({
      items: [{ publicId: 'role1', name: 'Managers', app: { publicId: 'sq_1', name: 'App' }, permissionCount: 0, userCount: 0 }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))

    await waitFor(() => expect(screen.getAllByText('Citadel').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Managers').length).toBeGreaterThan(0)
    expect(orgsActions.listOrgsAction).toHaveBeenCalledWith({ appId: 'sq_1', pageSize: 200 })
    expect(rolesActions.listRolesAction).toHaveBeenCalledWith({ appId: 'sq_1', pageSize: 200 })
  })

  it('includes defaultOrgId/defaultRoleId in the PATCH payload when changed', async () => {
    ;(orgsActions.listOrgsAction as jest.Mock).mockResolvedValue({
      items: [{ publicId: 'org1', name: 'Citadel', isPlatform: false, userCount: 0, app: { publicId: 'sq_1', name: 'App' } }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    ;(rolesActions.listRolesAction as jest.Mock).mockResolvedValue({
      items: [{ publicId: 'role1', name: 'Managers', app: { publicId: 'sq_1', name: 'App' }, permissionCount: 0, userCount: 0 }],
      total: 1,
      page: 1,
      pageSize: 200,
    })
    ;(actions.updateAppAction as jest.Mock).mockResolvedValue({ app })
    const onOpenChange = jest.fn()
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={onOpenChange} />))

    await waitFor(() => expect(screen.getAllByText('Citadel').length).toBeGreaterThan(0))

    fireEvent.change(screen.getByLabelText(en.apps.fields.defaultOrgNone), { target: { value: 'org1' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.defaultRoleNone), { target: { value: 'role1' } })

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.save }))

    await waitFor(() =>
      expect(actions.updateAppAction).toHaveBeenCalledWith(
        'sq_1',
        expect.objectContaining({ defaultOrgId: 'org1', defaultRoleId: 'role1' }),
      ),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })
})
