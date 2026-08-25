import { render, screen, fireEvent } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import messages from '@/messages/en.json'
import { RoleRowsEditor } from '../user-role-rows-editor'
import { PermissionRowsEditor } from '../role-permission-rows-editor'

const ROLES = [
  { publicId: 'r1', name: 'Admin' },
  { publicId: 'r2', name: 'Viewer' },
  { publicId: 'r3', name: 'Editor' },
]

const PERMS = [
  { publicId: 'p1', name: 'users.read' },
  { publicId: 'p2', name: 'users.write' },
]

function wrap(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  )
}

describe('RoleRowsEditor guard states', () => {
  it('asks for an org before anything else when no app is selected', () => {
    wrap(
      <RoleRowsEditor
        appId=""
        roles={ROLES}
        rows={[]}
        onRowsChange={jest.fn()}
        loading={false}
      />,
    )

    expect(
      screen.getByText(messages.users.fields.selectOrgFirst),
    ).toBeInTheDocument()
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('renders nothing selectable while roles are loading', () => {
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={[]}
        rows={[]}
        onRowsChange={jest.fn()}
        loading
      />,
    )

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  })

  it('explains when the app has no roles at all', () => {
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={[]}
        rows={[]}
        onRowsChange={jest.fn()}
        loading={false}
      />,
    )

    expect(
      screen.getByText(messages.users.fields.noRolesForApp),
    ).toBeInTheDocument()
  })

  it('shows the empty-state copy when there are no rows yet', () => {
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={ROLES}
        rows={[]}
        onRowsChange={jest.fn()}
        loading={false}
      />,
    )

    expect(screen.getByText(messages.users.drawer.noRoles)).toBeInTheDocument()
  })
})

describe('RoleRowsEditor row operations', () => {
  it('appends an empty row on add', () => {
    const onRowsChange = jest.fn()
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={ROLES}
        rows={['r1']}
        onRowsChange={onRowsChange}
        loading={false}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', { name: messages.users.fields.addRole }),
    )

    expect(onRowsChange).toHaveBeenCalledWith(['r1', ''])
  })

  it('replaces only the edited row', () => {
    const onRowsChange = jest.fn()
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={ROLES}
        rows={['r1', 'r2']}
        onRowsChange={onRowsChange}
        loading={false}
      />,
    )

    fireEvent.change(screen.getAllByRole('combobox')[1], {
      target: { value: 'r3' },
    })

    expect(onRowsChange).toHaveBeenCalledWith(['r1', 'r3'])
  })

  it('removes by index, not by value', () => {
    const onRowsChange = jest.fn()
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={ROLES}
        rows={['r1', 'r2', 'r3']}
        onRowsChange={onRowsChange}
        loading={false}
      />,
    )

    fireEvent.click(
      screen.getAllByRole('button', {
        name: messages.users.fields.removeRole,
      })[1],
    )

    expect(onRowsChange).toHaveBeenCalledWith(['r1', 'r3'])
  })
})

// The editors prevent duplicates by disabling an already-chosen option in
// every other row, rather than by rejecting the selection after the fact.
describe('RoleRowsEditor duplicate prevention', () => {
  it('disables a role already chosen in another row', () => {
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={ROLES}
        rows={['r1', '']}
        onRowsChange={jest.fn()}
        loading={false}
      />,
    )

    const secondRow = screen.getAllByRole('combobox')[1]
    const admin = Array.from(secondRow.querySelectorAll('option')).find(
      (o) => o.value === 'r1',
    ) as HTMLOptionElement

    expect(admin.disabled).toBe(true)
  })

  it('leaves the row that owns the value selectable', () => {
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={ROLES}
        rows={['r1', '']}
        onRowsChange={jest.fn()}
        loading={false}
      />,
    )

    const firstRow = screen.getAllByRole('combobox')[0]
    const admin = Array.from(firstRow.querySelectorAll('option')).find(
      (o) => o.value === 'r1',
    ) as HTMLOptionElement

    expect(admin.disabled).toBe(false)
  })

  it('does not treat the empty placeholder as taken across rows', () => {
    wrap(
      <RoleRowsEditor
        appId="a1"
        roles={ROLES}
        rows={['', '']}
        onRowsChange={jest.fn()}
        loading={false}
      />,
    )

    const secondRow = screen.getAllByRole('combobox')[1]
    const enabled = Array.from(secondRow.querySelectorAll('option')).filter(
      (o) => o.value !== '' && !o.disabled,
    )

    expect(enabled).toHaveLength(ROLES.length)
  })
})

describe('PermissionRowsEditor', () => {
  it('appends an empty row on add', () => {
    const onRowsChange = jest.fn()
    wrap(
      <PermissionRowsEditor
        appId="a1"
        perms={PERMS}
        rows={['p1']}
        onRowsChange={onRowsChange}
        loading={false}
      />,
    )

    fireEvent.click(
      screen.getByRole('button', {
        name: messages.roles.fields.addPermission,
      }),
    )

    expect(onRowsChange).toHaveBeenCalledWith(['p1', ''])
  })

  it('removes by index', () => {
    const onRowsChange = jest.fn()
    wrap(
      <PermissionRowsEditor
        appId="a1"
        perms={PERMS}
        rows={['p1', 'p2']}
        onRowsChange={onRowsChange}
        loading={false}
      />,
    )

    fireEvent.click(
      screen.getAllByRole('button', {
        name: messages.roles.fields.removePermission,
      })[0],
    )

    expect(onRowsChange).toHaveBeenCalledWith(['p2'])
  })

  it('disables a permission already chosen in another row', () => {
    wrap(
      <PermissionRowsEditor
        appId="a1"
        perms={PERMS}
        rows={['p1', '']}
        onRowsChange={jest.fn()}
        loading={false}
      />,
    )

    const secondRow = screen.getAllByRole('combobox')[1]
    const taken = Array.from(secondRow.querySelectorAll('option')).find(
      (o) => o.value === 'p1',
    ) as HTMLOptionElement

    expect(taken.disabled).toBe(true)
  })
})
