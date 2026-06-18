'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ColumnDef } from '@tanstack/react-table'
import { KeyRound, Plus, Search } from 'lucide-react'
import {
  Button, ButtonGroup, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, Badge,
} from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { deletePermissionAction, listPermissionsAction } from '@/app/(admin)/permissions/actions'
import type { App, PermissionRow, ListPermissionsResponse } from '@/lib/types'
import { PermissionViewDrawer } from './permission-view-drawer'
import { PermissionCreateDrawer } from './permission-create-drawer'
import { PermissionEditDrawer } from './permission-edit-drawer'
import { DeleteAlertDialog } from './delete-alert-dialog'
import { PageHeader } from './page-header'

interface Props { initial: ListPermissionsResponse; apps: App[] }

export function PermissionsTable({ initial, apps }: Props) {
  const t = useTranslations()
  const [data, setData] = React.useState(initial)
  const [query, setQuery] = React.useState('')
  const [appFilter, setAppFilter] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initial.pageSize ?? 25)
  const [selected, setSelected] = React.useState<PermissionRow | null>(null)
  const [viewOpen, setViewOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [copiedSqid, setCopiedSqid] = React.useState<string | null>(null)
  const initialRefRef = React.useRef(true)

  React.useEffect(() => {
    if (initialRefRef.current) {
      initialRefRef.current = false
      return
    }
    const timer = setTimeout(async () => {
      const params = {
        q: query || undefined,
        appId: appFilter || undefined,
        page, pageSize,
      }
      const result = await listPermissionsAction(params)
      if (result && 'items' in result) setData(result)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, appFilter, page, pageSize])

  const columns: ColumnDef<PermissionRow>[] = [
    {
      id: 'nameAndApp',
      header: t('permissions.columns.nameAndApp'),
      cell: ({ row }) => {
        const p = row.original
        const platform = p.name.startsWith('platform.')
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <KeyRound className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <code className="font-mono text-body-sm font-semibold">{p.name}</code>
                {platform && <Badge variant="secondary">{t('permissions.badges.platform')}</Badge>}
              </div>
              <p className="text-label-md text-muted-foreground">{p.app.name}</p>
            </div>
          </div>
        )
      },
    },
    {
      id: 'sqid',
      header: t('permissions.columns.sqid'),
      cell: ({ row }) => {
        const p = row.original
        const copied = copiedSqid === p.publicId
        return (
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-label-md">{p.publicId}</code>
            <button
              type="button"
              aria-label={t('permissions.actions.copy')}
              onClick={(e) => {
                e.stopPropagation()
                copyToClipboard(p.publicId, () => {
                  setCopiedSqid(p.publicId)
                  setTimeout(() => setCopiedSqid(null), 2000)
                })
              }}
              className="text-muted-foreground hover:text-primary"
            >
              <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
            </button>
          </div>
        )
      },
    },
    {
      id: 'usage',
      header: t('permissions.columns.usage'),
      cell: ({ row }) => (
        <span className="tabular-nums text-body-sm text-muted-foreground">
          {row.original.roleCount} {t('permissions.fields.rolesShort')} · {row.original.userCount} {t('permissions.fields.usersShort')}
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const p = row.original
        const platform = p.name.startsWith('platform.')
        const inUse = p.roleCount + p.userCount > 0
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button aria-label="more actions" className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                <span className="material-symbols-outlined text-[20px] text-muted-foreground">more_vert</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(p); setViewOpen(true) }}>
                {t('permissions.actions.view')}
              </DropdownMenuItem>
              {!platform && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(p); setEditOpen(true) }}>
                  {t('permissions.actions.edit')}
                </DropdownMenuItem>
              )}
              {!platform && <DropdownMenuSeparator />}
              {!platform && (
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (inUse) return
                    setSelected(p); setDeleteError(null); setDeleteOpen(true)
                  }}
                  title={inUse ? t('permissions.drawer.inUseTooltip', { roleCount: p.roleCount, userCount: p.userCount }) : undefined}
                  data-disabled={inUse ? '' : undefined}
                >
                  {t('permissions.actions.delete')}
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  async function handleDelete() {
    if (!selected) return
    const result = await deletePermissionAction(selected.publicId)
    if (result && 'errorKey' in result) {
      setDeleteError(t(result.errorKey))
      return
    }
    setDeleteOpen(false)
    setViewOpen(false)
    const refreshed = await listPermissionsAction({
      q: query || undefined, appId: appFilter || undefined, page, pageSize,
    })
    if (refreshed && 'items' in refreshed) setData(refreshed)
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { href: '/permissions', label: t('nav.accessControl') },
          { label: t('permissions.title') },
        ]}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only">{t('permissions.filter.appLabel')}</span>
              <select
                aria-label={t('permissions.filter.appLabel')}
                value={appFilter}
                onChange={(e) => { setAppFilter(e.target.value); setPage(1) }}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t('permissions.filter.allApps')}</option>
                {apps.map((a) => (
                  <option key={a.publicId} value={a.publicId}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder={t('permissions.search')}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                className="h-9 w-64 rounded-md border border-input bg-muted pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <ButtonGroup>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('permissions.create')}
              </Button>
            </ButtonGroup>
          </>
        }
      />

      <div className="px-8 py-4">
        <DataTable
          columns={columns}
          data={data.items}
          onRowClick={(p) => { setSelected(p); setViewOpen(true) }}
        />
        <Pagination
          page={page} pageSize={pageSize} total={data.total}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }}
          t={t}
        />
      </div>

      {selected && (
        <PermissionViewDrawer
          permission={selected}
          open={viewOpen}
          onOpenChange={setViewOpen}
          onEdit={() => { setViewOpen(false); setEditOpen(true) }}
          onDelete={() => { setDeleteError(null); setDeleteOpen(true) }}
        />
      )}
      {selected && (
        <PermissionEditDrawer
          permission={selected}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      <PermissionCreateDrawer apps={apps} open={createOpen} onOpenChange={setCreateOpen} />
      {selected && (
        <DeleteAlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('permissions.confirmDelete.title')}
          description={t('permissions.confirmDelete.body', { name: selected.name })}
          confirmLabel={t('permissions.confirmDelete.button')}
          cancelLabel={t('permissions.drawer.cancel')}
          error={deleteError}
          onConfirm={handleDelete}
        />
      )}
    </>
  )
}

function Pagination({
  page, pageSize, total, onPage, onPageSize, t,
}: { page: number; pageSize: number; total: number; onPage: (n: number) => void; onPageSize: (n: number) => void; t: ReturnType<typeof useTranslations> }) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)

  return (
    <div className="mt-4 flex items-center justify-between text-body-sm text-muted-foreground">
      <div className="flex items-center gap-3">
        <span>{t('permissions.pagination.showing', { from, to, total })}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-border bg-card px-2 py-1 text-body-sm"
        >
          {[5, 10, 25, 50].map((n) => (
            <option key={n} value={n}>{t('permissions.pagination.pageSize', { count: n })}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-30">
          {t('permissions.pagination.previous')}
        </button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-30">
          {t('permissions.pagination.next')}
        </button>
      </div>
    </div>
  )
}
