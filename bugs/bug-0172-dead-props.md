# bug-0172: UsersTable dead props (initialOrgId, canPickOrg)

The `UsersTable` component accepts `initialOrgId` and `canPickOrg` props
but immediately `void`s them — they are never used. These appear to be
placeholders for a planned org-scoped filtering feature that was never
implemented.

## File

`apps/admin/components/users-table.tsx:24-31`

## Resolution

Either implement org-scoped filtering or remove the dead props. This PR
tracks the cleanup option. The props and void expressions should be
removed from the component interface and function body.
