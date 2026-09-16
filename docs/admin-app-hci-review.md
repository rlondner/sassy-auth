# `apps/admin` — Next.js Architecture & HCI Review

**Scope:** `apps/admin` (Next.js App Router admin console for managing apps, users, orgs, roles and permissions in an auth product), plus the shared component library `packages/ui/src`.
**Method:** static review of RSC/client boundaries, data fetching, state management, accessibility, and interaction patterns. No new dependencies were installed or run; findings are cited to file paths and line ranges as of the current `dev` branch.

---

## Executive Summary

The app's foundations are sound — clean RSC/client boundaries, server-driven i18n, a well-executed route-level skeleton, and a disciplined form-feedback convention — but it behaves like a CRUD scaffold rather than a console someone lives in all day: every table is mouse-only (no keyboard row activation, no command palette), every mutation round-trips through a full `router.refresh()` with no optimistic update, and nothing in the app layer adapts to viewport width. The single highest-leverage fix is closing the keyboard/optimistic-UI gap on the data tables, since that is both the app's primary interaction surface and its most acute accessibility failure (WCAG 2.1.1).

---

## Immediate UI/UX & Codebase Fixes

| # | Issue | Location | Impact | Proposed Fix |
|---|-------|----------|--------|---------------|
| 1 | Clickable table rows have no keyboard affordance — `<tr onClick>` with no `role`, `tabIndex`, or `onKeyDown` | `packages/ui/src/components/ui/table.tsx:54-67`, `data-table.tsx:67-71` | **WCAG 2.1.1 failure.** The primary navigation action in every list page (opening a detail drawer) is entirely unreachable by keyboard. | Add `role="button" tabIndex={0}` and an `onKeyDown` handler (`Enter`/`Space`) to `TableRow` when `onRowClick` is supplied; add a visible `:focus-visible` ring. |
| 2 | Decorative icons never `aria-hidden` (34 occurrences of `material-symbols-outlined` spans) | `users-table.tsx:121`, `app-view-drawer.tsx:27`, `password-requirements-checklist.tsx:31`, etc. | Screen readers announce ligature text or noise next to already-labeled controls. | Add `aria-hidden="true"` to every purely decorative icon span; codify via a shared `<Icon>` wrapper so it can't be forgotten. |
| 3 | No focus-return management on `Sheet`/`Dialog` close, and drawers are triggered by non-focusable row clicks | `packages/ui/src/components/ui/sheet.tsx`, `dialog.tsx` (no `onCloseAutoFocus` override) | After closing a drawer opened by row-click, focus lands on `<body>` — user loses their place. | Capture the triggering row ref before opening; pass `onCloseAutoFocus` to restore focus to it (ties into fix #1's `tabIndex`). |
| 4 | Zero responsive breakpoints anywhere in `apps/admin` (`sm:`/`md:`/`lg:` grep returns 0 hits outside `packages/ui`'s sidebar) | `apps/admin/app/**`, `apps/admin/components/**` | Tables and 2-column drawer forms overflow or crush on narrow viewports; no mobile/tablet adaptation. | Add `md:`/`lg:` variants to `PageHeader` padding, `DataTable` wrapper, and collapse drawer `grid-cols-2` to `grid-cols-1` below `md`. |
| 5 | List filters and pagination are local-only `useState`, not URL state (only `orgId` on `/users` survives reload) | `users-table.tsx:34`, same pattern in `apps-table.tsx`, `orgs-table.tsx`, `roles-table.tsx`, `permissions-table.tsx`; no `useSearchParams` usage repo-wide | Refresh, back/forward navigation, or sharing a link silently discards the user's search/sort/page. | Lift `globalFilter`/sort/page into `useSearchParams` + `router.replace(..., { scroll: false })`, matching the existing `orgId` pattern. |
| 6 | `DataTable` has filtering/sorting row models wired but no `getPaginationRowModel`; server already paginates (`getOrgs({ pageSize: 200 })`, `getApps({ page: 1, pageSize: 25 })`) with no UI affordance | `packages/ui/src/components/data-table.tsx:26-34`, `users/page.tsx:43`, `apps/page.tsx:8` | Lists beyond one page are silently truncated with no "page 2" anywhere in the UI. | Wire `getPaginationRowModel`, expose page controls in `DataTable`, and reflect page number in the URL (pairs with fix #5). |
| 7 | No optimistic UI — every mutation waits for the server action, then calls `router.refresh()` with no interim skeleton | `users-table.tsx:48` and equivalent callbacks in every table | A beat of stale UI after delete/deactivate/create, no perceived responsiveness. | Wrap list mutations in `useOptimistic` (React 19) or a local reducer that removes/inserts the row immediately, reconciling on `router.refresh()` completion. |
| 8 | Global error boundary drops all page chrome (sidebar, breadcrumb) | `apps/admin/app/(admin)/error.tsx:18-28` | A single failed fetch (e.g. `throw usersResult.reason` in `users/page.tsx:63`) strands the user with no way to navigate elsewhere except a hard reload. | Render `error.tsx` inside the persistent `AdminShell`/sidebar, not as a bare full-page replacement. |
| 9 | Duplicate, uncached session validation: `middleware.ts` already fetches `/api/auth/get-session` with a 10s cache; `(admin)/layout.tsx` fetches it again, uncached, just to set the Sentry user | `apps/admin/middleware.ts:100-127`, `app/(admin)/layout.tsx:10-18` | An extra full HTTP round trip to auth-server on every navigation the middleware cache was built to avoid. | Pass the already-validated session from middleware via a header/`x-session` cookie, or read it once in the layout and skip the middleware's redundant check. |
| 10 | Render-blocking, non-self-hosted font `<link>` bypasses `next/font` used elsewhere for the primary typeface | `apps/admin/app/layout.tsx:27-30` (raw `<link href="https://fonts.googleapis.com/...">`) vs. `layout.tsx:9-13` (`next/font/google` Manrope, correctly `display: swap`) | Unoptimized, render-blocking external request on every page load; undermines the `next/font` investment. | Self-host Material Symbols via `next/font/local` or replace with `lucide-react` SVGs (see paradigm #1 below — also fixes icon-sizing debt). |
| 11 | Icon sizing is 30+ arbitrary Tailwind values (`text-[14px]`, `text-[20px]`, `text-[32px]`...) because Material Symbols are font ligatures, not components | `sidebar-shell.tsx:53,61`, `app-edit-drawer.tsx:457,488`, `roles-table.tsx:101,128`, etc. | No shared icon-size scale; two parallel icon systems coexist (Material Symbols spans + `lucide-react` SVGs already used in `sidebar-shell.tsx:50`). | Standardize on `lucide-react` (already a dependency, already RSC-friendly per the app's own icon-name-across-boundary pattern) and delete the Material Symbols font link. |
| 12 | No `onBlur`/live validation — errors surface only after submit, and only clear on the next submit | `user-create-drawer.tsx:87-96` (`validate()` called solely from `handleSubmit`), zero `onBlur` hits repo-wide | Users can't tell a field is fixed until they resubmit the whole form. | Re-run per-field validation in the existing `set()` helper (`user-create-drawer.tsx:83-85`) so errors clear live as the user types/blurs. |
| 13 | Ad hoc required-field markup (`<span className="ml-0.5 text-destructive">*</span>` without `aria-hidden`) duplicates the accessible `FormField` component | `user-create-drawer.tsx:196` vs. `packages/ui/src/components/form-field.tsx:34-38` (which does it correctly) | Inconsistent accessible-name/required semantics between drawers that use `FormField` and ones that hand-roll the label. | Route all form fields through `FormField`; delete inline label/asterisk markup. |
| 14 | Copy-to-clipboard "Copied!" feedback (`useCopyFeedback`) reimplemented independently in 5 files | `apps-table.tsx`, `orgs-table.tsx`, `roles-table.tsx`, `permissions-table.tsx`, `user-create-drawer.tsx` | Drift risk; five slightly different implementations of the same micro-interaction. | Extract a single `<CopyButton>` component in `packages/ui`. |
| 15 | `qrcode.react` and `@marsidev/react-turnstile` (which injects an external Cloudflare script) are imported eagerly at module scope of client components, despite `next/dynamic` never being used anywhere in the app (0 hits repo-wide) | `app/account/security/SecurityClient.tsx:4` (used only conditionally at line 226), `app/signup/signup-form.tsx:10` | Both ship in the initial bundle for a feature/step most visits don't reach. | `next/dynamic(() => import(...), { ssr: false })` for both; establishes the first code-splitting precedent in the app. |
| 16 | `next.config.ts` has no `experimental.optimizePackageImports` despite named imports from `lucide-react` and `@tanstack/react-table` in many client components | `apps/admin/next.config.ts:9-19` | Missed low-effort tree-shaking win. | Add `experimental: { optimizePackageImports: ['lucide-react'] }`. |
| 17 | No command palette / global keyboard shortcuts (`cmdk`, `metaKey`, "command palette" — 0 hits) | repo-wide | For a console spanning 5+ resource types, every cross-navigation requires a sidebar click. | See Proposed HCI Paradigm #1. |

**Worth calling out as strengths** (not fixes, but patterns to preserve and extend): the RSC/client split in `admin-shell.tsx` / `sidebar-shell.tsx` with icon names passed as strings across the server/client boundary; server-driven `next-intl` setup with per-locale dynamic `import()` (`i18n/request.ts:8`); the `loading.tsx` skeleton shaped to match its table (`app/(admin)/loading.tsx:9-21`, `aria-busy`/`aria-live` included); consistent `loading`/`disabled` props on all submit buttons; and the deliberate `aria-label` fix on the search input with a comment explaining *why* placeholder text isn't sufficient (`users-table.tsx:201-211`) — a precedent the rest of the app should be held to.

---

## Architectural & Performance Enhancements

1. **Collapse the session round-trip.** Middleware already validates and caches the session (`middleware.ts:30-31`, 10s TTL); the admin layout should consume that result instead of re-fetching (finding #9). This removes one auth-server call per navigation on the hottest path in the app.

2. **Short-circuit the users-page waterfall for the common case.** `users/page.tsx:20-58` always resolves perms/profile before users/orgs, but the profile lookup is only needed for org-scoped views. For platform admins (`isPlatformUsers === true`, no `orgIdParam`) — the most common path — skip straight to `getUsers()`.

3. **Introduce `<Suspense>` boundaries inside pages, not just at the route segment.** Today `loading.tsx` is the *only* loading boundary; a page blocks entirely on its slowest `Promise.allSettled` batch. Wrapping independently-ready sections (e.g. a users table vs. a secondary stats panel) in `<Suspense>` lets fast data stream in without waiting on the slowest fetch.

4. **Establish a code-splitting baseline.** Zero `next/dynamic` usage today. Start with the two clear candidates (Turnstile, QR code — finding #15), then apply the same treatment to any future heavy, conditionally-rendered widget (charts, rich text editors).

5. **Replace the Material Symbols font-ligature icon system with `lucide-react` everywhere.** This simultaneously removes a render-blocking external font request (finding #10), eliminates the 30+ arbitrary `text-[Npx]` values (finding #11), and unifies the app onto the icon system it already uses correctly in the sidebar — with no bundle-size cost since `lucide-react` is already a dependency and tree-shakes per icon.

6. **Turn on `optimizePackageImports`** for `lucide-react` and `@tanstack/react-table` (finding #16) — a one-line config change with no behavioral risk.

7. **Reconsider the client-side data-grid footprint.** All five resource tables (`users-table.tsx`, `orgs-table.tsx`, `apps-table.tsx`, `roles-table.tsx`, `permissions-table.tsx`) are full `'use client'` components holding the entire row dataset. This is reasonable while lists stay small (~dozens of rows), but combined with the missing pagination UI (finding #6), a tenant with hundreds of users would ship an unbounded row set to the client. Fixing pagination (both server- and URL-driven) bounds this before it becomes a real payload problem.

---

## Proposed HCI Paradigms

### 1. Keyboard-first data grid + command palette

**Problem it solves:** findings #1, #3, #17 — the core interaction (open a row's detail drawer) is mouse-only, there's no fast cross-resource navigation, and focus is lost on drawer close.

**Design:** Every table row becomes a `roving-tabindex` list item (arrow keys move focus, `Enter`/`Space` opens the drawer, `Escape` closes and returns focus to the row). A global `Cmd+K` palette (built on `cmdk`, already compatible with the shadcn/Radix primitives already in `packages/ui`) lets users jump directly to "Users → jane@…", "Create app", or any nav destination without touching the sidebar.

**Component hierarchy:**
```
AdminShell (RSC)
 └─ CommandPaletteProvider (client, mounted once in admin-shell.tsx)
     ├─ CommandPaletteDialog (client, cmdk Command + Dialog)
     └─ children (existing table pages, unchanged)
DataTable (client)
 └─ TableRow[] — role="row", each cell wraps in a focusable "row activator"
     onKeyDown: Enter/Space → onRowClick(row); ArrowUp/Down → move roving tabIndex
```

**State strategy:** Palette open/query state lives in a small client Context (`CommandPaletteProvider`) scoped to the admin shell — no need for Zustand/Redux given the narrow surface. Command results for "jump to resource" hit the same server actions the tables already call (`getUsers`, `getApps`, …) via a debounced client fetch; static commands (navigation, "create X") are a hardcoded list, no fetch needed.

**Key snippet — keyboard row activation in `TableRow`:**
```tsx
// packages/ui/src/components/ui/table.tsx
function TableRow({ onActivate, ...props }: TableRowProps) {
  return (
    <tr
      {...props}
      tabIndex={onActivate ? 0 : undefined}
      role={onActivate ? "button" : undefined}
      onKeyDown={(e) => {
        if (onActivate && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onActivate();
        }
      }}
    />
  );
}
```

**Key snippet — palette shell:**
```tsx
// apps/admin/components/command-palette.tsx
"use client";
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);
  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Jump to a user, app, or action…" />
      <CommandList>{/* static nav + debounced resource search */}</CommandList>
    </CommandDialog>
  );
}
```

---

### 2. Local-first optimistic mutations (zero-latency table updates)

**Problem it solves:** finding #7 — every create/edit/delete waits for the server action then does a full `router.refresh()`, leaving a beat of stale UI with no interim feedback.

**Design:** Wrap each table's row list in React 19's `useOptimistic`. On delete/deactivate, the row disappears immediately with a subtle fade (using the CSS `transition-opacity` utilities already present, no new animation dependency needed); on create, a placeholder row appears instantly and is reconciled with real data once `router.refresh()` resolves. On failure, the optimistic change reverts and the existing toast (`sonner`) reports the error — reusing an established pattern (finding #5 in the UX audit) rather than inventing a new one.

**State strategy:** `useOptimistic(rows, reducer)` local to each table component; no global store needed since each table already owns its row list as a prop from the RSC page. The reducer handles three actions: `remove`, `upsert`, `revert`.

**Key snippet:**
```tsx
// apps/admin/components/users-table.tsx
const [optimisticRows, applyOptimistic] = useOptimistic(
  rows,
  (state, action: { type: "remove" | "upsert"; row: UserRow }) =>
    action.type === "remove"
      ? state.filter((r) => r.id !== action.row.id)
      : [action.row, ...state.filter((r) => r.id !== action.row.id)]
);

async function handleDelete(row: UserRow) {
  startTransition(() => applyOptimistic({ type: "remove", row }));
  const result = await deleteUser(row.id);
  if (result.error) toast.error(result.error);
  router.refresh(); // reconciles optimistic state with server truth
}
```
This directly targets the "did my delete actually work" gap flagged in the UX audit (finding #18: no motion or optimistic signal today), without introducing Framer Motion — CSS transitions on mount/unmount are enough for this scale of UI.

---

### 3. Context-preserving, adaptive table shell

**Problem it solves:** findings #4, #5, #6 — no responsive layout, filters/pagination live only in local state and vanish on reload, and there's no mobile adaptation for the fixed 2-column drawer forms.

**Design:** Promote filter text, sort column, and page number into the URL via `useSearchParams`, matching the pattern the app already uses correctly for `orgId` on `/users`. This makes every list view a shareable, back/forward-safe, refresh-safe link — genuine context preservation across navigation, one of the three HCI pillars called out in this review's brief. Pair it with a responsive `DataTable` that switches from a table layout to a stacked card list below `md`, and collapses drawer `grid-cols-2` forms to a single column on small viewports.

**Component hierarchy:**
```
UsersPage (RSC) — reads searchParams, passes to getUsers()
 └─ UsersTable (client)
     └─ useTableUrlState(["q", "sort", "page"]) — syncs local UI state ⇄ URL
     └─ DataTable
         ├─ (≥md) <table> — unchanged
         └─ (<md) <StackedRowList> — same row data, card layout
```

**Key snippet — URL-synced filter/sort/page hook:**
```tsx
// apps/admin/components/use-table-url-state.ts
"use client";
export function useTableUrlState(keys: string[]) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const get = (key: string) => params.get(key) ?? "";
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  return { get, set };
}
```

**Key snippet — responsive collapse in the shared table wrapper:**
```tsx
// packages/ui/src/components/data-table.tsx
<div className="overflow-auto">
  <table className="hidden md:table">{/* existing table markup */}</table>
  <ul className="md:hidden divide-y">
    {rows.map((row) => (
      <StackedRow key={row.id} row={row} onActivate={() => onRowClick?.(row.original)} />
    ))}
  </ul>
</div>
```

This is a self-contained addition to the existing `DataTable` — no new state library, no layout engine, and it reuses the same `onRowClick`/keyboard-activation contract from Paradigm #1 so mobile and desktop share one interaction model.
