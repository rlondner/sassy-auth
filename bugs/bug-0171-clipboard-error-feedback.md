# bug-0171: Copy-to-clipboard handlers silently swallow clipboard API failures

## Problem

All admin table and drawer components that have "copy to clipboard" buttons
call `navigator.clipboard.writeText()` without catching errors. If the
Clipboard API is unavailable (HTTP context, permission denied, Firefox
restrictions), the copy silently fails with no user feedback.

## Affected files

- `apps/admin/components/apps-table.tsx`
- `apps/admin/components/orgs-table.tsx`
- `apps/admin/components/roles-table.tsx`
- `apps/admin/components/permissions-table.tsx`
- `apps/admin/components/app-view-drawer.tsx`
- `apps/admin/components/org-view-drawer.tsx`
- `apps/admin/components/permission-view-drawer.tsx`
- `apps/admin/components/role-view-drawer.tsx`
- `apps/admin/components/app-edit-drawer.tsx`
- `apps/admin/components/org-edit-drawer.tsx`
- `apps/admin/components/permission-edit-drawer.tsx`
- `apps/admin/components/role-edit-drawer.tsx`
- `apps/admin/components/user-create-drawer.tsx`

## Fix

Wrap clipboard calls in try/catch and show `toast.error()` on failure:

```typescript
try {
  await navigator.clipboard.writeText(value)
  setCopied(id)
} catch {
  toast.error('Failed to copy to clipboard')
}
```
