'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ColumnDef } from '@tanstack/react-table'
import { Plus, Search } from 'lucide-react'
import {
  Button, ButtonGroup, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, StatusChip, UserAvatar,
} from '@sassy-auth/ui'
import type { User, Org } from '@/lib/types'
import { UserViewDrawer } from './user-view-drawer'
import { UserCreateDrawer } from './user-create-drawer'
import { DeleteAlertDialog } from './delete-alert-dialog'
import { PageHeader } from './page-header'
import { deleteUserAction } from '@/app/(admin)/users/actions'

interface UsersTableProps {
  users: User[]
  orgs: Org[]
  initialOrgId?: string
}

export function UsersTable({ users, orgs, initialOrgId }: UsersTableProps) {
  const t = useTranslations()
  void initialOrgId
  const [globalFilter, setGlobalFilter] = React.useState('')
  const [selectedUser, setSelectedUser] = React.useState<User | null>(null)
  const [viewOpen, setViewOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)

  const orgMap = React.useMemo(
    () => Object.fromEntries(orgs.map((o) => [o.id, o])),
    [orgs],
  )

  const columns: ColumnDef<User>[] = [
    {
      id: 'user',
      accessorFn: (row) => `${row.firstName} ${row.lastName} ${row.email}`,
      header: t('users.columns.user'),
      cell: ({ row }) => {
        const u = row.original
        return (
          <div className="flex items-center gap-3">
            <UserAvatar firstName={u.firstName} lastName={u.lastName} />
            <div>
              <p className="text-body-sm font-semibold text-foreground">{u.firstName} {u.lastName}</p>
              <p className="text-label-md text-muted-foreground">{u.email}</p>
            </div>
          </div>
        )
      },
    },
    {
      accessorKey: 'status',
      header: t('users.columns.status'),
      cell: ({ row }) => (
        <StatusChip
          variant={row.original.status}
          label={t(`users.status.${row.original.status}`)}
        />
      ),
    },
    {
      id: 'org',
      header: t('users.columns.org'),
      cell: ({ row }) => orgMap[row.original.orgId]?.name ?? row.original.orgId,
    },
    {
      id: 'lastLogin',
      header: t('users.columns.lastLogin'),
      cell: ({ row }) => {
        const ts = row.original.lastLoginAt
        if (!ts) return <span className="text-muted-foreground">{t('users.fields.never')}</span>
        return new Date(ts).toLocaleDateString()
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const u = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button
                aria-label={t('users.actions.moreActions')}
                className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted"
              >
                <span className="material-symbols-outlined text-[20px] text-muted-foreground">more_vert</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelectedUser(u); setViewOpen(true) }}>
                {t('users.actions.edit')}
              </DropdownMenuItem>
              {u.status === 'active' && (
                <DropdownMenuItem>{t('users.actions.resetPassword')}</DropdownMenuItem>
              )}
              {u.status === 'pending' && (
                <DropdownMenuItem>{t('users.actions.resendInvitation')}</DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              {u.status === 'active' ? (
                <DropdownMenuItem className="text-destructive">{t('users.actions.deactivate')}</DropdownMenuItem>
              ) : u.status === 'inactive' ? (
                <DropdownMenuItem>{t('users.actions.activate')}</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="text-destructive"
                onClick={(e) => { e.stopPropagation(); setSelectedUser(u); setDeleteError(null); setDeleteOpen(true) }}
              >
                {t('users.actions.delete')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        crumbs={[
          { href: '/users', label: t('nav.directory') },
          { label: t('users.title') },
        ]}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder={t('users.search')}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="h-9 w-64 rounded-md border border-input bg-muted pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <ButtonGroup>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('users.addUser')}
              </Button>
            </ButtonGroup>
          </>
        }
      />

      {/* Table */}
      <div className="px-8 py-4">
        <DataTable
          columns={columns}
          data={users}
          globalFilter={globalFilter}
          onRowClick={(user) => { setSelectedUser(user); setViewOpen(true) }}
        />
      </div>

      {/* Drawers */}
      <UserViewDrawer
        user={selectedUser}
        orgs={orgs}
        open={viewOpen}
        onOpenChange={setViewOpen}
      />
      <UserCreateDrawer
        orgs={orgs}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      {selectedUser && (
        <DeleteAlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('users.confirmDelete.title')}
          description={t('users.confirmDelete.body', { name: `${selectedUser.firstName} ${selectedUser.lastName}` })}
          confirmLabel={t('users.confirmDelete.button')}
          cancelLabel={t('users.drawer.cancel')}
          error={deleteError}
          onConfirm={async () => {
            const result = await deleteUserAction(selectedUser.id)
            if ('errorKey' in result) {
              setDeleteError(t(result.errorKey))
              return
            }
            setDeleteOpen(false)
          }}
        />
      )}
    </>
  )
}
