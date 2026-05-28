'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ColumnDef } from '@tanstack/react-table'
import {
  Button, ConfirmDialog, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, StatusChip, UserAvatar,
} from '@sassy-auth/ui'
import type { User, Org } from '@/lib/types'
import { UserViewDrawer } from './user-view-drawer'
import { UserCreateDrawer } from './user-create-drawer'
import { deleteUserAction } from '@/app/(admin)/users/actions'

interface UsersTableProps {
  users: User[]
  orgs: Org[]
}

export function UsersTable({ users, orgs }: UsersTableProps) {
  const t = useTranslations()
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
              <p className="text-body-sm font-semibold text-[var(--foreground)]">{u.firstName} {u.lastName}</p>
              <p className="text-label-md text-[var(--muted-foreground)]">{u.email}</p>
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
        if (!ts) return <span className="text-[var(--muted-foreground)]">{t('users.fields.never')}</span>
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
              <button className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--muted)]">
                <span className="material-symbols-outlined text-[20px] text-[var(--muted-foreground)]">more_vert</span>
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
                <DropdownMenuItem className="text-[var(--destructive)]">{t('users.actions.deactivate')}</DropdownMenuItem>
              ) : u.status === 'inactive' ? (
                <DropdownMenuItem>{t('users.actions.activate')}</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem
                className="text-[var(--destructive)]"
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
      {/* Page header */}
      <div className="border-b border-[var(--border)] bg-[var(--card)] px-container-padding py-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-headline-md">{t('users.title')}</h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-[var(--muted-foreground)]">search</span>
              <input
                type="search"
                placeholder={t('users.search')}
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="h-9 w-64 rounded border border-[var(--border)] bg-[var(--card)] pl-8 pr-3 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
            <button className="flex h-9 items-center gap-1.5 rounded border border-[var(--border)] px-3 text-body-sm hover:bg-[var(--muted)]">
              <span className="material-symbols-outlined text-[18px]">filter_list</span>
              Filter
            </button>
            <Button onClick={() => setCreateOpen(true)}>
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t('users.addUser')}
            </Button>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="px-container-padding py-4">
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
        open={viewOpen}
        onOpenChange={setViewOpen}
      />
      <UserCreateDrawer
        orgs={orgs}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
      {selectedUser && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('users.confirmDelete.title')}
          description={t('users.confirmDelete.body', { name: `${selectedUser.firstName} ${selectedUser.lastName}` })}
          confirmLabel={t('users.confirmDelete.button')}
          cancelLabel={t('users.drawer.cancel')}
          variant="destructive"
          onConfirm={async () => {
            const result = await deleteUserAction(selectedUser.id)
            if ('errorKey' in result) {
              const msg = t(result.errorKey)
              setDeleteError(msg)
              throw new Error(msg) // keep dialog open via ConfirmDialog's error path
            }
          }}
          error={deleteError ?? undefined}
        />
      )}
    </>
  )
}
