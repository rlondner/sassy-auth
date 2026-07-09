# Sidebar active-route highlight

## Problem

The admin sidebar always highlights **Users**, regardless of the current page. Navigating to `/apps`, `/orgs`, `/roles`, or `/permissions` leaves Users visually selected and offers no indication of where the user is.

## Root cause

`apps/admin/app/(admin)/layout.tsx:25` reads the current pathname from an `x-pathname` request header:

```ts
const pathname = headersList.get('x-pathname') ?? '/users'
```

`apps/admin/middleware.ts` never sets that header. The fallback therefore always wins, so `currentPath` is the constant string `'/users'` and `currentPath.startsWith(item.href)` in `sidebar-shell.tsx:65` only ever matches the Users item.

The active-state styling itself (lines 71–76) is correct and applies `data-active="true"` via the shadcn `SidebarMenuButton` — it just receives bad input.

## Approach

Remove the header indirection entirely. `SidebarShell` is already a client component (`'use client'`), so it can read the pathname directly with `usePathname()` from `next/navigation`.

This is preferred over patching the middleware because:

- The header dance only existed to feed a value the client can fetch itself.
- The `?? '/users'` fallback is a silent footgun — it masked this bug and would mask any future regression of the same kind. Deleting the indirection deletes the fallback.
- Net change: smaller surface area, fewer props, more idiomatic App Router.

## Scope of change

Three files in `apps/admin/`:

### 1. `components/sidebar-shell.tsx`

- Add `import { usePathname } from 'next/navigation'`.
- Remove `currentPath: string` from `SidebarShellProps`.
- Remove `currentPath` from the destructured args.
- Inside the component body, add `const currentPath = usePathname() ?? ''`.
- The existing `currentPath.startsWith(item.href)` line (currently :65) is unchanged.

### 2. `components/admin-shell.tsx`

- Remove `currentPath: string` from `AdminShellProps`.
- Remove `currentPath` from the destructured args.
- Remove `currentPath={currentPath}` from the `<SidebarShell>` props.

### 3. `app/(admin)/layout.tsx`

- Remove `headers` from the `next/headers` import (keep `cookies`, still used by `getSession`).
- Remove the `headersList` and `pathname` lines.
- Remove `currentPath={pathname}` from `<AdminShell>`.

## Active-match semantics

Keep `currentPath.startsWith(item.href)` so nested routes (e.g. `/users/123/edit`) still highlight their parent nav entry.

Nav hrefs are `/apps`, `/orgs`, `/users`, `/roles`, `/permissions` — all distinct, none is a prefix of another, so no double-highlight risk. The home `/` route has no nav entry and intentionally lights nothing.

## Testing

Extend `apps/admin-e2e/tests/authed/admin-nav.spec.ts`. The test already navigates to `/users`, reloads, then visits `/apps` and `/orgs`. After each `goto`/`reload`, assert:

- The nav link for the current route has `data-active="true"`.
- The other nav links have `data-active="false"` (or do not have `data-active="true"`).

Select links by their localized accessible name (the existing test already uses `t(...)` for headings).

Existing unit tests do not render `SidebarShell` and require no changes. The `cookies()` flow in the layout is untouched, so the authed-redirect e2e behavior is unchanged.

## Out of scope

- Middleware: not touched. The `x-pathname` header is no longer read by anyone.
- Home `/` route highlighting: no nav entry points there; leave as is.
- Visual restyling of the active item: existing brand-600 styling stays.
