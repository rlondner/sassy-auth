'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { ColumnDef } from '@tanstack/react-table'
import { Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import {
  Button, ButtonGroup, DataTable, DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger, Badge, Tooltip, TooltipContent, TooltipTrigger,
} from '@sassy-auth/ui'
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import { deleteOrgAction, listOrgsAction } from '@/app/(admin)/orgs/actions'
import type { App, OrgRow, ListOrgsResponse } from '@/lib/types'
import { OrgViewDrawer } from './org-view-drawer'
import { OrgCreateDrawer } from './org-create-drawer'
import { OrgEditDrawer } from './org-edit-drawer'
import { DeleteAlertDialog } from './delete-alert-dialog'
import { PageHeader } from './page-header'

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
  const { copiedKey: copiedSqid, copy: copySqid } = useCopyFeedback()
  const initialRefRef = React.useRef(true)

  React.useEffect(() => {
    if (initialRefRef.current) {
      initialRefRef.current = false
      return
    }
    let cancelled = false
    const timer = setTimeout(async () => {
      const params = {
        q: query || undefined,
        appId: appFilter || undefined,
        page,
        pageSize,
      }
      const result = await listOrgsAction(params)
      // bug-0137: guard against stale in-flight response overwriting
      // state after a newer query has superseded this effect.
      if (cancelled) return
      if (result && 'items' in result) setData(result)
    }, 300)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [query, appFilter, page, pageSize])

  const columns: ColumnDef<OrgRow>[] = [
    {
      id: 'nameAndApp',
      header: t('orgs.columns.nameAndApp'),
      cell: ({ row }) => {
        const o = row.original
        return (
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded border border-border bg-muted text-primary">
              <span className="material-symbols-outlined text-[20px]">corporate_fare</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <p className="text-body-sm font-semibold">{o.name}</p>
                {o.isPlatform && <Badge variant="secondary">{t('orgs.badges.platform')}</Badge>}
              </div>
              <p className="text-label-md text-muted-foreground">{o.app.name}</p>
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
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-label-md">{o.publicId}</code>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={t('common.copy')}
                  onClick={(e) => {
                    e.stopPropagation()
                    void copySqid(o.publicId, o.publicId)
                  }}
                  className="text-muted-foreground hover:text-primary"
                >
                  <span className="material-symbols-outlined text-[14px]">{copied ? 'check' : 'content_copy'}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{copied ? t('common.copied') : t('common.copy')}</TooltipContent>
            </Tooltip>
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
            <Tooltip>
              <TooltipTrigger asChild>
                <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                  <button aria-label={t('common.moreActions')} className="flex h-7 w-7 items-center justify-center rounded hover:bg-muted">
                    <span className="material-symbols-outlined text-[20px] text-muted-foreground">more_vert</span>
                  </button>
                </DropdownMenuTrigger>
              </TooltipTrigger>
              <TooltipContent>{t('common.moreActions')}</TooltipContent>
            </Tooltip>
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
                  className="text-destructive"
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

  const refresh = React.useCallback(async () => {
    const refreshed = await listOrgsAction({
      q: query || undefined, appId: appFilter || undefined, page, pageSize,
    })
    if (refreshed && 'items' in refreshed) {
      setData(refreshed)
      // bug-0206: rebase `selected` on the refreshed rows so drawers
      // reflect current data, or clear if the row is gone.
      setSelected((prev) =>
        prev ? refreshed.items.find((r) => r.publicId === prev.publicId) ?? null : null,
      )
    }
  }, [query, appFilter, page, pageSize])

  async function handleDelete() {
    if (!selected) return
    const result = await deleteOrgAction(selected.publicId)
    if (result && 'errorKey' in result) {
      setDeleteError(t(result.errorKey))
      return
    }
    setDeleteOpen(false)
    setViewOpen(false)
    toast.success(t('orgs.toast.deleted'))
    await refresh()
  }

  return (
    <>
      <PageHeader
        crumbs={[
          { href: '/orgs', label: t('nav.directory') },
          { label: t('orgs.title') },
        ]}
        actions={
          <>
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="sr-only">{t('orgs.filter.appLabel')}</span>
              <select
                aria-label={t('orgs.filter.appLabel')}
                value={appFilter}
                onChange={(e) => { setAppFilter(e.target.value); setPage(1) }}
                className="h-9 rounded-md border border-input bg-card px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">{t('orgs.filter.allApps')}</option>
                {apps.map((a) => (
                  <option key={a.publicId} value={a.publicId}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                placeholder={t('orgs.search')}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setPage(1) }}
                className="h-9 w-64 rounded-md border border-input bg-muted pl-9 pr-3 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <ButtonGroup>
              <Button size="sm" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                {t('orgs.create')}
              </Button>
            </ButtonGroup>
          </>
        }
      />

      <div className="px-8 py-4">
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
          onSuccess={refresh}
        />
      )}
      <OrgCreateDrawer apps={apps} open={createOpen} onOpenChange={setCreateOpen} onSuccess={refresh} />
      {selected && (
        <DeleteAlertDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('orgs.confirmDelete.title')}
          description={t('orgs.confirmDelete.body', { name: selected.name })}
          confirmLabel={t('orgs.confirmDelete.button')}
          cancelLabel={t('orgs.drawer.cancel')}
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
        <span>{t('orgs.pagination.showing', { from, to, total })}</span>
        <select
          value={pageSize}
          onChange={(e) => onPageSize(Number(e.target.value))}
          className="rounded border border-border bg-card px-2 py-1 text-body-sm"
        >
          {[5, 10, 25, 50].map((n) => (
            <option key={n} value={n}>{t('orgs.pagination.pageSize', { count: n })}</option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="rounded border border-border px-2 py-1 disabled:opacity-30">
          {t('orgs.pagination.previous')}
        </button>
        <span>{page} / {totalPages}</span>
        <button disabled={page >= totalPages} onClick={() => onPage(page + 1)} className="rounded border border-border px-2 py-1 disabled:opacity-30">
          {t('orgs.pagination.next')}
        </button>
      </div>
    </div>
  )
}
