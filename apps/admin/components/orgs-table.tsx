'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ColumnDef } from '@tanstack/react-table'
import {
  Button, ConfirmDialog, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, Badge,
} from '@sassy-auth/ui'
import { copyToClipboard } from '@/lib/clipboard'
import { deleteOrgAction, listOrgsAction } from '@/app/(admin)/orgs/actions'
import type { App, OrgRow, ListOrgsResponse } from '@/lib/types'
import { OrgViewDrawer } from './org-view-drawer'
import { OrgCreateDrawer } from './org-create-drawer'
import { OrgEditDrawer } from './org-edit-drawer'

interface Props { initial: ListOrgsResponse; apps: App[] }

export function OrgsTable({ initial, apps }: Props) {
  const t = useTranslations()
  const [data, setData] = React.useState(initial)
  const [query, setQuery] = React.useState('')
  const [appFilter, setAppFilter] = React.useState('')
  const [page, setPage] = React.useState(1)
  const [pageSize, setPageSize] = React.useState(initial.pageSize ?? 25)
  const [selected, setSelected] = React.useState<OrgRow | null>(null)
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
        page,
        pageSize,
      }
      const result = await listOrgsAction(params)
      if (result && 'items' in result) setData(result)
    }, 300)
    return () => clearTimeout(timer)
  }, [query, appFilter, page, pageSize])

  const columns: ColumnDef<OrgRow>[] = [
    {
      id: 'nameAndApp',
      header: t('orgs.columns.nameAndApp'),
      cell: ({ row }) => {
        const o = row.original
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-[var(--border)] bg-[var(--muted)] text-[var(--primary)]">
              <span className="material-symbols-outlined text-[20px]">corporate_fare</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-body-sm font-semibold">{o.name}</p>
                {o.isPlatform && <Badge variant="secondary">{t('orgs.badges.platform')}</Badge>}
              </div>
              <p className="text-label-md text-[var(--muted-foreground)]">{o.app.name}</p>
            </div>
          </div>
        )
      },
    },
    {
      id: 'app',
      header: t('orgs.columns.app'),
      cell: ({ row }) => row.original.app.name,
    },
    {
      id: 'sqid',
      header: t('orgs.columns.sqid'),
      cell: ({ row }) => {
        const o = row.original
        const copied = copiedSqid === o.publicId
        return (
          <div className="flex items-center gap-2">
            <code className="rounded bg-[var(--muted)] px-1.5 py-0.5 font-mono text-label-md">{o.publicId}</code>
            <button
              type="button"
              aria-label={t('orgs.actions.copy')}
              onClick={(e) => {
                e.stopPropagation()
                copyToClipboard(o.publicId, () => {
                  setCopiedSqid(o.publicId)
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
      id: 'userCount',
      header: t('orgs.columns.users'),
      cell: ({ row }) => (
        <span className="tabular-nums">{t('orgs.fields.userCount', { count: row.original.userCount })}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => {
        const o = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
              <button aria-label="more actions" className="flex h-7 w-7 items-center justify-center rounded hover:bg-[var(--muted)]">
                <span className="material-symbols-outlined text-[20px] text-[var(--muted-foreground)]">more_vert</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(o); setViewOpen(true) }}>
                {t('orgs.actions.view')}
              </DropdownMenuItem>
              {!o.isPlatform && (
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setSelected(o); setEditOpen(true) }}>
                  {t('orgs.actions.edit')}
                </DropdownMenuItem>
              )}
              {!o.isPlatform && <DropdownMenuSeparator />}
              {!o.isPlatform && (
                <DropdownMenuItem
                  className="text-[var(--destructive)]"
                  onClick={(e) => { e.stopPropagation(); setSelected(o); setDeleteError(null); setDeleteOpen(true) }}
                >
                  {t('orgs.actions.delete')}
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
    const result = await deleteOrgAction(selected.publicId)
    if (result && 'errorKey' in result) {
      const msg = t(result.errorKey)
      setDeleteError(msg)
      throw new Error(msg)
    }
    setDeleteOpen(false)
    setViewOpen(false)
    const refreshed = await listOrgsAction({
      q: query || undefined, appId: appFilter || undefined, page, pageSize,
    })
    if (refreshed && 'items' in refreshed) setData(refreshed)
  }

  return (
    <>
      <div className="border-b border-[var(--border)] bg-[var(--card)] px-container-padding py-5">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-headline-md">
            {t('orgs.title')}{' '}
            <span className="ml-2 rounded-full bg-[var(--primary)]/10 px-2 py-0.5 text-label-sm text-[var(--primary)]">
              {t('orgs.totalCount', { count: data.total })}
            </span>
          </h1>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-body-sm text-[var(--muted-foreground)]">
              <span className="sr-only">{t('orgs.filter.appLabel')}</span>
              <select
                aria-label={t('orgs.filter.appLabel')}
                value={appFilter}
                onChange={(e) => { setAppFilter(e.target.value); setPage(1) }}
                className="h-9 rounded border border-[var(--border)] bg-[var(--card)] px-2 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              >
                <option value="">{t('orgs.filter.allApps')}</option>
                {apps.map((a) => (
                  <option key={a.publicId} value={a.publicId}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="relative">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[18px] text-[var(--muted-foreground)]">search</span>
              <input
                type="search"
                placeholder={t('orgs.search')}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                className="h-9 w-72 rounded border border-[var(--border)] bg-[var(--card)] pl-8 pr-3 text-body-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
              />
            </div>
            <Button onClick={() => setCreateOpen(true)}>
              <span className="material-symbols-outlined text-[18px]">add</span>
              {t('orgs.create')}
            </Button>
          </div>
        </div>
      </div>

      <div className="px-container-padding py-4">
        <DataTable
          columns={columns}
          data={data.items}
          onRowClick={(o) => { setSelected(o); setViewOpen(true) }}
        />
        <Pagination
          page={page} pageSize={pageSize} total={data.total}
          onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1) }}
          t={t}
        />
      </div>

      {selected && (
        <OrgViewDrawer
          org={selected}
          open={viewOpen}
          onOpenChange={setViewOpen}
          onEdit={() => { setViewOpen(false); setEditOpen(true) }}
          onDelete={() => { setDeleteError(null); setDeleteOpen(true) }}
        />
      )}
      {selected && (
        <OrgEditDrawer
          org={selected}
          open={editOpen}
          onOpenChange={setEditOpen}
        />
      )}
      <OrgCreateDrawer apps={apps} open={createOpen} onOpenChange={setCreateOpen} />
      {selected && (
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('orgs.confirmDelete.title')}
          description={t('orgs.confirmDelete.body', { name: selected.name })}
          confirmLabel={t('orgs.confirmDelete.button')}
          cancelLabel={t('orgs.drawer.cancel')}
          variant="destructive"
          onConfirm={handleDelete}
          error={deleteError ?? undefined}
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
        <span>{t('orgs.pagination.showing', { from, to, total })}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-body-sm"
        >
          {[5, 10, 25, 50].map((n) => (
            <option key={n} value={n}>{t('orgs.pagination.pageSize', { count: n })}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-30">
          {t('orgs.pagination.previous')}
        </button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-[var(--border)] px-2 py-1 disabled:opacity-30">
          {t('orgs.pagination.next')}
        </button>
      </div>
    </div>
  )
}
