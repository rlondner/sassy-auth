'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ColumnDef } from '@tanstack/react-table'
import {
  Button, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, Badge,
} from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { deleteAppAction, listAppsAction } from '@/app/(admin)/apps/actions'
import type { App, ListAppsResponse } from '@/lib/types'
import { AppViewDrawer } from './app-view-drawer'
import { AppCreateDrawer } from './app-create-drawer'
import { AppEditDrawer } from './app-edit-drawer'
import { DeleteAlertDialog } from './delete-alert-dialog'

interface Props { initial: ListAppsResponse }

export function AppsTable({ initial }: Props) {
  const t = useTranslations()
  const [data, setData] = React.useState(initial)
  const [query, setQuery] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initial.pageSize ?? 25)
  const [selected, setSelected] = React.useState<App | null>(null)
  const [viewOpen, setViewOpen] = React.useState(false)
  const [editOpen, setEditOpen] = React.useState(false)
  const [createOpen, setCreateOpen] = React.useState(false)
  const [deleteOpen, setDeleteOpen] = React.useState(false)
  const [deleteError, setDeleteError] = React.useState<string | null>(null)
  const [copiedSqid, setCopiedSqid] = React.useState<string | null>(null)
  const initialRefRef = React.useRef(true)

  // Debounced refetch when query / page / pageSize change.
  React.useEffect(() => {
    if (initialRefRef.current) {
      initialRefRef.current = false
      return
    }
    const timer = setTimeout(async () => {
      const result = await listAppsAction({ q: query || undefined, page, pageSize })
      if (result && 'items' in result) setData(result)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, page, pageSize])

  const columns: ColumnDef<App>[] = [
    {
      id: 'nameAndUrl',
      header: t('apps.columns.nameAndUrl'),
      cell: ({ row }) => {
        const a = row.original
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[var(--border)] bg-[var(--muted)] text-[var(--primary)]">
              <span className="material-symbols-outlined text-[20px]">apps</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-body-sm font-semibold">{a.name}</p>
                {a.isPlatform && <Badge variant="secondary">{t('apps.badges.platform')}</Badge>}
              </div>
              <p className="text-label-md text-[var(--muted-foreground)]">{a.url}</p>
            </div>
          </div>
        )
      },
    },
    {
      id: 'sqid',
      header: t('apps.columns.sqid'),
      cell: ({ row }) => {
        const a = row.original
        const copied = copiedSqid === a.publicId
        return (
          <div className="flex items-center gap-2">
            <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-label-md">{a.publicId}</code>
            <button
              type="button"
              aria-label={t('apps.actions.copy')}
              onClick={(e) => {
                e.stopPropagation()
                copyToClipboard(a.publicId, () => {
                  setCopiedSqid(a.publicId)
                  setTimeout(() => setCopiedSqid(null), 2000)
                })
              }}
              className="text-[var(--muted-foreground)] hover:text-[var(--primary)]"
            >
              <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
            </button>
          </div>
        )
      },
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const a = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button aria-label="more actions" className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--muted)]">
                <span className="material-symbols-outlined text-[20px] text-[var(--muted-foreground)]">more_vert</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(a); setViewOpen(true) }}>
                {t('apps.actions.view')}
              </DropdownMenuItem>
              {!a.isPlatform && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(a); setEditOpen(true) }}>
                  {t('apps.actions.edit')}
                </DropdownMenuItem>
              )}
              {!a.isPlatform && <DropdownMenuSeparator />}
              {!a.isPlatform && (
                <DropdownMenuItem
                  className="text-[var(--destructive)]"
                  onClick={(e) => { e.stopPropagation(); setSelected(a); setDeleteError(null); setDeleteOpen(true) }}
                >
                  {t('apps.actions.delete')}
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
    const result = await deleteAppAction(selected.publicId)
    if (result && 'errorKey' in result) {
      setDeleteError(t(result.errorKey))
      return
    }
    setDeleteOpen(false)
    setViewOpen(false)
    const refreshed = await listAppsAction({ q: query || undefined, page, pageSize })
    if (refreshed && 'items' in refreshed) setData(refreshed)
  }

  return (
    <>
      <div className="border-b border-[var(--border)] bg-[var(--card)] px-container-padding py-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-headline-md">
            {t('apps.title')}{' '}
            <span className="ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-label-sm text-[var(--primary)]">
              {t('apps.totalCount', { count: data.total })}
            </span>
          </h1>
          <div className="flex items-center gap-3">
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-[var(--muted-foreground)]">search</span>
              <input
                type="search"
                placeholder={t('apps.search')}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                className="h-9 w-72 rounded border border-[var(--border)] bg-[var(--card)] pl-8 pr-3 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t('apps.create')}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-container-padding py-4">
        <DataTable
          columns={columns}
          data={data.items}
          onRowClick={(a) => { setSelected(a); setViewOpen(true) }}
        />
        <Pagination
          page={page} pageSize={pageSize} total={data.total}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }}
          t={t}
        />
      </div>

      {selected && (
        <AppViewDrawer
          app={selected}
          open={viewOpen}
          onOpenChange={setViewOpen}
          onEdit={() => { setViewOpen(false); setEditOpen(true) }}
          onDelete={() => { setDeleteError(null); setDeleteOpen(true) }}
        />
      )}
      {selected && (
        <AppEditDrawer
          app={selected}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      <AppCreateDrawer open={createOpen} onOpenChange={setCreateOpen} />
      {selected && (
        <DeleteAlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('apps.confirmDelete.title')}
          description={t('apps.confirmDelete.body', { name: selected.name })}
          confirmLabel={t('apps.confirmDelete.button')}
          cancelLabel={t('apps.drawer.cancel')}
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
    <div className="mt-4 flex items-center justify-between text-body-sm text-[var(--muted-foreground)]">
      <div className="flex items-center gap-3">
        <span>{t('apps.pagination.showing', { from, to, total })}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-body-sm"
        >
          {[5, 10, 25, 50].map((n) => (
            <option key={n} value={n}>{t('apps.pagination.pageSize', { count: n })}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-30">
          {t('apps.pagination.previous')}
        </button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-30">
          {t('apps.pagination.next')}
        </button>
      </div>
    </div>
  )
}
