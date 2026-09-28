import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { AppCreateDrawer } from '../app-create-drawer'
import * as actions from '@/app/(admin)/apps/actions'

jest.mock('@/app/(admin)/apps/actions', () => ({
  createAppAction: jest.fn(),
}))

// Radix Select is awkward to drive in JSDOM (it relies on pointer events that
// JSDOM does not implement). Swap it for a thin native <select> shim so tests
// can call fireEvent.change to pick a value. Mirrors the shim in
// app-edit-drawer.test.tsx.
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
            const grandchildren = (child.props as ChildrenProps).children
            return React.Children.toArray(grandchildren)
          })}
        </select>
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

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

describe('AppCreateDrawer', () => {
  beforeEach(() => jest.clearAllMocks())

  it('submits valid form and closes', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({
      app: { publicId: 'sq_1', name: 'X', url: 'https://x.example', isPlatform: false },
    })
    const onOpenChange = jest.fn()
    render(withIntl(<AppCreateDrawer open onOpenChange={onOpenChange} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url), { target: { value: 'https://x.example' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createAppAction).toHaveBeenCalledWith({
        name: 'X',
        url: 'https://x.example',
        logo: null,
        redirectUris: [],
        // 2FA per-app enforcement (bug-free defaults for a fresh app): the
        // drawer always sends both fields so an unchecked box is an explicit
        // `false` rather than an omission the API would have to interpret.
        requireTwoFactor: false,
        twoFactorTrustDays: null,
      }),
    )
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false))
  })

  it('surfaces 409 nameExists error inline', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({ errorKey: 'apps.errors.nameExists' })
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'Dup' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url), { target: { value: 'https://x.example' } })
    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() => expect(screen.getByText(en.apps.errors.nameExists)).toBeInTheDocument())
  })

  // Task 4: the create drawer gets the same repeatable redirect-URI list as
  // the edit drawer, with the same "no login URIs registered" warning.
  it('shows the no-login-URIs warning by default and clears it once a login URI is added', () => {
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    expect(screen.getByText(en.apps.fields.noLoginUrisWarning)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: en.apps.fields.addRedirectUri }))
    fireEvent.change(screen.getByLabelText(en.apps.fields.redirectUris), {
      target: { value: 'https://x.example/cb' },
    })
    expect(screen.queryByText(en.apps.fields.noLoginUrisWarning)).not.toBeInTheDocument()
  })

  it('submits added redirect URIs with the create payload', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({
      app: { publicId: 'sq_1', name: 'X', url: 'https://x.example', isPlatform: false },
    })
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url), { target: { value: 'https://x.example' } })

    fireEvent.click(screen.getByRole('button', { name: en.apps.fields.addRedirectUri }))
    fireEvent.change(screen.getByLabelText(en.apps.fields.redirectUris), {
      target: { value: 'https://x.example/cb' },
    })

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createAppAction).toHaveBeenCalledWith(
        expect.objectContaining({
          redirectUris: [{ uri: 'https://x.example/cb', kind: 'login' }],
        }),
      ),
    )
  })

  it('includes a picked logo in the create payload', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({
      app: { publicId: 'sq_1', name: 'X', url: 'https://x.example', isPlatform: false },
    })
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url), { target: { value: 'https://x.example' } })

    const file = new File(['a'.repeat(10)], 'logo.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(en.apps.fields.logo), { target: { files: [file] } })
    await waitFor(() => expect(screen.getByRole('img')).toBeInTheDocument())

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createAppAction).toHaveBeenCalledWith(
        expect.objectContaining({ logo: expect.stringMatching(/^data:image\/png;base64,/) }),
      ),
    )
  })

  it('includes twoFactorPromptEnabled in the create payload when set to "Never show"', async () => {
    ;(actions.createAppAction as jest.Mock).mockResolvedValue({
      app: { publicId: 'sq_1', name: 'X', url: 'https://x.example', isPlatform: false },
    })
    render(withIntl(<AppCreateDrawer open onOpenChange={() => undefined} />))
    fireEvent.change(screen.getByLabelText(en.apps.fields.name), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.url), { target: { value: 'https://x.example' } })
    fireEvent.change(screen.getByLabelText(en.apps.fields.twoFactorPromptEnabled), { target: { value: 'false' } })

    fireEvent.click(screen.getByRole('button', { name: en.apps.drawer.createTitle }))
    await waitFor(() =>
      expect(actions.createAppAction).toHaveBeenCalledWith(
        expect.objectContaining({ twoFactorPromptEnabled: false }),
      ),
    )
  })
})
