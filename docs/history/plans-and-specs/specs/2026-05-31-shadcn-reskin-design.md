# Shadcn Reskin — Design

**Date:** 2026-05-31
**Scope:** apps/admin (the admin console) + packages/ui (the shared UI library)
**Driver:** `designs/main-design/variant.html` (light) + `designs/main-design/variant-dark.html` (dark)

## Goal

Replace the hand-authored UI primitives in `@sassy-auth/ui` with shadcn/ui primitives generated via the shadcn CLI, then restyle the admin console end-to-end to match `designs/main-design/variant.html`. The headline change is a real `Sidebar` component driving `admin-shell.tsx`; the rest of the chrome (page headers, tables, drawers, delete dialogs, buttons) is re-themed to match.

## Non-goals

- New routes, new data flows, new server actions.
- The design's user-detail view (banner + per-org role/permission cards, `variant.html` lines 2217-2725) — that page doesn't exist in the app yet. Noted as a follow-up; not built here.
- Internationalization changes. All `useTranslations` / `getTranslations` calls and i18n keys stay.

## Theme tokens

The design uses Tailwind's `blue` palette as its brand color (`brand-50` … `brand-900` literally are `blue-50` … `blue-900`). The current theme uses indigo `#3525cd`. **Swap the primary to blue-600 (#2563eb)** so the design works verbatim and so every `bg-[var(--primary)]` and `text-[var(--primary)]` callsite picks up the new palette for free.

`packages/ui/globals.css` gets shadcn-style HSL CSS variables for both light and dark modes. Tailwind `darkMode: 'class'` means a `.dark` class on `<html>` flips the variables. The `next-themes` provider toggles that class; a `ThemeToggle` component in the sidebar footer drives it.

```css
:root {
  /* Light mode — variant.html */
  --background: 0 0% 100%;
  --foreground: 222 47% 11%;
  --card: 0 0% 100%;
  --card-foreground: 222 47% 11%;
  --popover: 0 0% 100%;
  --popover-foreground: 222 47% 11%;
  --primary: 221 83% 53%;          /* blue-600 = #2563eb */
  --primary-foreground: 0 0% 100%;
  --secondary: 210 40% 96%;
  --secondary-foreground: 222 47% 11%;
  --muted: 210 40% 96%;
  --muted-foreground: 215 16% 47%;
  --accent: 210 40% 96%;
  --accent-foreground: 222 47% 11%;
  --destructive: 0 84% 60%;
  --destructive-foreground: 0 0% 100%;
  --border: 214 32% 91%;
  --input: 214 32% 91%;
  --ring: 221 83% 53%;
  --radius: 0.5rem;

  /* Sidebar — always dark in light mode, per variant.html */
  --sidebar: 222 47% 11%;            /* #0f172a */
  --sidebar-foreground: 215 16% 65%;
  --sidebar-primary: 221 83% 53%;
  --sidebar-primary-foreground: 0 0% 100%;
  --sidebar-accent: 217 33% 17%;
  --sidebar-accent-foreground: 0 0% 100%;
  --sidebar-border: 217 33% 17%;
  --sidebar-ring: 221 83% 53%;
}

.dark {
  /* Dark mode — variant-dark.html (night-* palette) */
  --background: 225 50% 8%;          /* #0a0f1e (night-base) */
  --foreground: 213 27% 84%;         /* slate-300 */
  --card: 220 39% 11%;               /* #111827 (night-card / slate-900) */
  --card-foreground: 213 27% 84%;
  --popover: 220 39% 11%;
  --popover-foreground: 213 27% 84%;
  --primary: 217 91% 60%;            /* brand-500 = #60a5fa */
  --primary-foreground: 225 50% 8%;  /* inverted — dark text on light brand */
  --secondary: 217 33% 17%;
  --secondary-foreground: 213 27% 84%;
  --muted: 217 33% 17%;
  --muted-foreground: 215 20% 65%;
  --accent: 217 33% 17%;
  --accent-foreground: 213 27% 84%;
  --destructive: 0 63% 50%;
  --destructive-foreground: 213 27% 84%;
  --border: 217 33% 17%;             /* #1f2937 (night-border / slate-800) */
  --input: 217 33% 17%;
  --ring: 217 91% 60%;

  /* Sidebar in dark mode — even deeper than the content area */
  --sidebar: 220 47% 5%;             /* #070b14 (night-sidebar) */
  --sidebar-foreground: 215 20% 65%;
  --sidebar-primary: 217 91% 60%;
  --sidebar-primary-foreground: 225 50% 8%;
  --sidebar-accent: 217 33% 17%;
  --sidebar-accent-foreground: 213 27% 84%;
  --sidebar-border: 217 33% 17%;
  --sidebar-ring: 217 91% 60%;
}
```

The legacy hex tokens (`--primary: #3525cd`, etc.) and the legacy `--sidebar-bg`/`--sidebar-fg` tokens are **deleted** — every callsite either flips to a shadcn token or to a Tailwind utility. The legacy typography scale (`text-headline-md`, `text-body-sm`, …) **stays**: it's used in dozens of places and removing it is unrelated churn.

`packages/ui/tailwind.config.ts`:
- Set `darkMode: 'class'` so Tailwind's `dark:` variants respond to the `.dark` class on `<html>`.
- Add the shadcn color shape (`background`, `foreground`, `card`, `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`, `ring`, `sidebar`) reading the HSL vars.
- Add `colors.brand` as the full blue 50–900 scale (so the design's classnames like `bg-brand-50` work verbatim).
- Add `tailwindcss-animate` plugin.
- Keep the existing `spacing.pane-nav` (still used elsewhere) until the sidebar swap is done, then remove.

## Where shadcn lives

- `components.json` lives in `packages/ui` (so `@sassy-auth/ui` is the single source of truth for primitives across the monorepo). The shadcn CLI is run from there with `--cwd packages/ui`.
- Generated files land at `packages/ui/src/components/ui/*.tsx`.
- `packages/ui/src/index.ts` re-exports the new primitives. The admin app keeps importing from `@sassy-auth/ui` — no `apps/admin/components/ui/` directory is created.
- `ConfirmDialog` becomes a thin backward-compat wrapper around `AlertDialog` (preserves the existing test + drawer call sites without a sweeping rename).

## Primitives to generate

`sidebar`, `button`, `button-group`, `alert-dialog`, `dropdown-menu`, `sheet`, `dialog`, `input`, `label`, `badge`, `table`, `select`, `separator`, `avatar`, `card`, `breadcrumb`, `tooltip`, `scroll-area`.

(Some are already present in spirit in `@sassy-auth/ui`. They get replaced wholesale.)

## Sidebar (the headline change)

`apps/admin/components/admin-shell.tsx` becomes:

```tsx
<SidebarProvider>
  <Sidebar collapsible="icon">
    <SidebarHeader>
      <Logo />              {/* shield SVG + "SassyAuth" + "Admin Console" */}
    </SidebarHeader>
    <SidebarContent>
      <SidebarGroup>
        <SidebarGroupLabel>Directory</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton isActive={...}>Apps</SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton>Organizations</SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton>Users</SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
      <SidebarGroup>
        <SidebarGroupLabel>Access Control</SidebarGroupLabel>
        <SidebarMenu>
          <SidebarMenuItem><SidebarMenuButton>Roles</SidebarMenuButton></SidebarMenuItem>
          <SidebarMenuItem><SidebarMenuButton>Permissions</SidebarMenuButton></SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroup>
    </SidebarContent>
    <SidebarFooter>
      <UserFooter user={user}>
        <LocaleSwitcher />        {/* moves here from header */}
        <SignOutButton />
      </UserFooter>
    </SidebarFooter>
  </Sidebar>
  <SidebarInset>{children}</SidebarInset>
</SidebarProvider>
```

Active item style matches design line 1882: `bg-brand-600 text-white shadow-sm ring-1 ring-brand-700/50`.

`AdminShell` is currently a server component (it `await getTranslations()`). `SidebarProvider` is a client component. Resolution: make `AdminShell` render a thin client wrapper that holds `SidebarProvider`, and pass translated strings + user data down as props. The page route layout stays a server component.

## Theme toggle (light / dark)

- `next-themes` is added to `apps/admin` and a `ThemeProvider` (client component) wraps the app in `apps/admin/app/layout.tsx` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`. The `<html>` tag also gets `suppressHydrationWarning` (next-themes contract).
- A `ThemeToggle` component (icon button: sun in light, moon in dark) renders in the `UserFooter` next to the locale switcher and sign-out icon. Click cycles light → dark → system; rendering reads `useTheme()`.
- The toggle is hydration-safe: it mounts a placeholder icon button until `useEffect` runs (otherwise SSR/CSR mismatch on first paint).
- The shadcn `Sidebar` already responds to dark mode (its `--sidebar-*` tokens differ between `:root` and `.dark`). No extra work in the sidebar itself — the existing `bg-sidebar` / `text-sidebar-foreground` classnames pick up the new HSL values automatically.

## AlertDialog migration

Three call sites: `users-table.tsx`, `orgs-table.tsx`, `apps-table.tsx`. Each currently uses `ConfirmDialog`. Each becomes:

```tsx
<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>{t('...confirmDelete.title')}</AlertDialogTitle>
      <AlertDialogDescription>{t('...confirmDelete.body', { name })}</AlertDialogDescription>
    </AlertDialogHeader>
    {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
    <AlertDialogFooter>
      <AlertDialogCancel disabled={pending}>{t('...drawer.cancel')}</AlertDialogCancel>
      <AlertDialogAction
        onClick={(e) => { e.preventDefault(); handleDelete() }}
        disabled={pending}
        className={buttonVariants({ variant: 'destructive' })}
      >
        {pending ? '…' : t('...confirmDelete.button')}
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

Pending/error state moves into each table component (it was hidden inside `ConfirmDialog`; lifting it out matches shadcn idiom).

`ConfirmDialog` itself becomes a back-compat wrapper that takes the old API and renders the new `AlertDialog` underneath. Existing tests for `ConfirmDialog` keep passing.

## ButtonGroup usage

Three concrete uses:
- **Page header actions** — e.g., `[Reset Password] [Edit User]` in design line 2190 — grouped.
- **Drawer footers** — `[Cancel] [Save]` — grouped.
- **Pagination prev/next** — attached buttons.

## Page chrome

A new `PageHeader` component (in `apps/admin/components/page-header.tsx`):

- 64px tall white bar, `border-b border-slate-200`, `px-8`.
- Left: breadcrumb (using shadcn `Breadcrumb`) — for now, single-level (the page title), with multi-level support reserved for the future user-detail view.
- Right: search input + action `ButtonGroup`.

Applied to `apps/admin/components/{apps,orgs,users}-table.tsx` — replacing the current inline `<div className="border-b border-[var(--border)] bg-[var(--card)] px-container-padding py-5">` header.

## Tables

`@sassy-auth/ui`'s `Table`/`DataTable` swap to shadcn's `Table`. Styling per design:
- Header row: `bg-slate-50/50 text-slate-500 text-xs font-semibold uppercase tracking-wider`.
- Body rows: `border-b border-slate-200`, hover `bg-slate-50`.
- Cells: `px-6 py-4 text-sm`.

`StatusChip` and `Badge` swap to shadcn `Badge` with variant-driven color mapping (`active` → emerald, `pending` → amber, `inactive` → slate, etc.).

## Drawers

`Sheet` swaps to shadcn `Sheet`. Drawer cards inside drawer bodies switch to `rounded-xl shadow-sm border border-slate-200`. Section labels: `text-xs font-semibold uppercase tracking-wider text-slate-500`.

Avatars in the design have per-user pastel ring colors (orange, emerald, purple, pink, indigo, teal, rose). The existing `UserAvatar` already computes a deterministic color from initials — extend its palette to match the design's pastels.

## Locale switcher

Currently in `admin-shell.tsx`'s sidebar header. Moves into the sidebar footer next to the user avatar — more discoverable, matches the design's "settings live near the user" convention.

## Icons

- **Material Symbols** stays as the icon font for table-cell icons (cost of churning every cell is not worth it for a visual reskin).
- **lucide-react** is added and used for new chrome only: sidebar nav, page headers, dialogs, drawer headers, button-group buttons.

## Tests

- Existing component tests assert i18n text + behavior, not class names. Spot-check `users-table.test.tsx`, `apps-table.test.tsx`, `orgs-table.test.tsx`, the drawer tests, `confirm-dialog.test.tsx`, and `data-table.test.tsx` for class-name assertions and update where shadcn rendered markup differs.
- New shadcn primitives don't need bespoke tests — they're well-covered upstream. The wrapper components (PageHeader, etc.) get a smoke test asserting they render the title and the action buttons.

## File-touch list

**Net new:**
- `packages/ui/components.json`
- `packages/ui/src/components/ui/sidebar.tsx`, `button.tsx`, `button-group.tsx`, `alert-dialog.tsx`, `dropdown-menu.tsx`, `sheet.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `badge.tsx`, `table.tsx`, `select.tsx`, `separator.tsx`, `avatar.tsx`, `card.tsx`, `breadcrumb.tsx`, `tooltip.tsx`, `scroll-area.tsx`, `skeleton.tsx`
- `apps/admin/components/page-header.tsx`
- `apps/admin/components/sidebar-shell.tsx`
- `apps/admin/components/user-footer.tsx`
- `apps/admin/components/theme-provider.tsx`
- `apps/admin/components/theme-toggle.tsx`
- `apps/admin/components/delete-alert-dialog.tsx`

**Modified:**
- `packages/ui/tailwind.config.ts`
- `packages/ui/globals.css`
- `packages/ui/package.json` (add `tailwindcss-animate`, `lucide-react`)
- `packages/ui/src/index.ts`
- `packages/ui/src/components/confirm-dialog.tsx` (becomes a back-compat wrapper)
- `packages/ui/src/components/user-avatar.tsx` (extend pastel palette)
- `apps/admin/package.json` (add `lucide-react`, `next-themes`)
- `apps/admin/components/admin-shell.tsx` (big rewrite)
- `apps/admin/components/locale-switcher.tsx` (style + position)
- `apps/admin/components/access-denied-panel.tsx`
- `apps/admin/components/users-table.tsx`, `orgs-table.tsx`, `apps-table.tsx`
- `apps/admin/components/{user,org,app}-{view,create,edit}-drawer.tsx` (8 files)
- `apps/admin/app/(admin)/layout.tsx` (only if signature changes)
- `apps/admin/app/layout.tsx` (ensure Inter font is loaded)

Plus targeted test fixes where class-name assertions break.

## Verification

1. `pnpm test` in `@sassy-auth/ui` and `apps/admin` — all green.
2. `pnpm build` in `apps/admin` — succeeds, no type errors.
3. `pnpm dev`, visit `/apps`, `/orgs`, `/users` — visually compare against `variant.html`. Screenshot each, plus a delete dialog and a drawer.
4. Tab through the sidebar and confirm collapsible-to-icon works (free shadcn feature).

## Risk register

- **Theme swap (indigo → blue)** ripples through every existing `bg-[var(--primary)]` and `text-[var(--primary)]`. Because they're CSS-variable-driven, the change is automatic and benign — every "primary"-colored thing in the app turns blue.
- **Material Symbols + lucide-react cohabit.** Different stroke weights look slightly inconsistent up close. Mitigation: confine lucide to the new chrome.
- **`AdminShell` becoming partially client.** `SidebarProvider` needs `'use client'`. The layout passes server-fetched data (user, locales) down as props — no behavior change, but a touch more boilerplate.
- **Test churn** if class-name assertions exist. Audit pass before refactoring; update tests in the same commits as the components they cover.
- **Theme flash on first paint.** `next-themes` solves this only if (a) the `ThemeProvider` is the topmost client wrapper, (b) `<html suppressHydrationWarning>` is set, and (c) `disableTransitionOnChange` is enabled. Easy to get one of the three wrong; visual check on a hard reload will catch it.
- **Existing component styling assuming light.** Any hardcoded `bg-white`, `text-slate-900`, `from-brand-600 to-indigo-800` (drawer banner), `bg-slate-50/50` (table hover), or pastel `bg-orange-100` (avatars) will look wrong in dark mode. Mitigation: use `bg-card`/`text-foreground`/`bg-muted` semantic tokens wherever possible, and use Tailwind's `dark:` variant for the few pastels that don't have a dark equivalent (avatars get a `dark:bg-orange-900/40 dark:text-orange-300` per-class override; the design uses the same approach).
