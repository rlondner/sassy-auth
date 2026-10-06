# Collapsible themed sections for the App drawers — design

**Date:** 2026-10-05
**Status:** approved design, no implementation plan yet
**Scope:** reorganize the ~20 fields in `AppCreateDrawer`, `AppEditDrawer`, and
`AppViewDrawer` into six themed, independently-collapsible sections, replacing
the current single long flat scroll. Generalizes the collapsible pattern that
today only exists for the Password Policy block in the Edit drawer.

---

## 1. Problem and stance

`AppEditDrawer` (and its Create/View siblings) render every app property —
name/URL, logo/favicon/background colors, redirect URIs, 2FA settings,
password policy, default org/role, social providers, public ID, client
secret, webhook URL/secret, legal URLs, activation email, email verification
method — as one long flat scroll. The only field group that gets any
collapsing today is Password Policy (`app-edit-drawer.tsx`, added in
`6f49e28`), via a bespoke checkbox-driven show/hide — not a reusable pattern.

This spec:

- Groups the fields into six themed sections, applied consistently (same
  grouping and section IDs) across Create, Edit, and View.
- Introduces a reusable `CollapsibleSection` primitive in `@sassy-auth/ui` so
  future drawers (orgs, roles, users) can adopt the same pattern instead of
  reinventing it.
- Replaces the bespoke Password Policy toggle's expand/collapse chrome with
  the new primitive; the override checkbox and its own show/hide of the
  policy *fields* stays as app-specific behavior nested inside the `security`
  section.
- Makes each section independently toggleable (not an accordion — several
  sections can be open at once).
- Persists each section's collapsed/expanded state per drawer type, shared
  across all apps, so a user's preferred layout sticks between visits.

## 2. The six sections

Same grouping, order, and section `id`s (the persistence/ARIA keys) across
Create, Edit, and View — but **Create only renders the sections it has
fields for**. Today Create has no UI at all for default org/role, social
providers, client secret, webhooks, legal URLs, activation email, or email
verification method — those are configured via Edit after the app exists.
This spec does not add those fields to Create; it only reorganizes what
each drawer already has. So Create renders `general`, `branding`, and a
`security` with fewer fields than Edit/View's (see table); it does not
render `access`, `credentials`, or `legal` at all.

| id | Label | Edit / View fields | Create fields |
|---|---|---|---|
| `general` | General | name, URL, public ID *(View only)* | name, URL |
| `branding` | Branding | logo, favicon, page/card background colors (light + dark) | same |
| `security` | Sign-in & Security | redirect URIs, 2FA trust days, 2FA prompt, require 2FA, allow offline access, password policy | redirect URIs, 2FA trust days, 2FA prompt, require 2FA *(no allow-offline-access or password policy — Create has neither field today)* |
| `access` | Org Defaults & Social | default org, default role, social sign-in providers | *(not rendered)* |
| `credentials` | Credentials & Webhooks | client secret, activation webhook URL + secret | *(not rendered)* |
| `legal` | Legal & Email | privacy policy/terms/GDPR URLs, activation email override, email verification method | *(not rendered)* |

The existing Password Policy override toggle and its conditional field block
(`app-edit-drawer.tsx:505-610`) move inside `security`'s body unchanged in
behavior — only its outer collapsible chrome is replaced by `CollapsibleSection`.

## 3. `CollapsibleSection` component (`@sassy-auth/ui`)

New primitive, built on `@radix-ui/react-collapsible` (not yet a dependency —
add it the same way `select`/`dialog`/etc. were added via the shadcn CLI, per
`docs/history/plans-and-specs/plans/2026-05-31-shadcn-reskin.md`'s pattern).

```tsx
interface CollapsibleSectionProps {
  id: string                 // stable id: "general" | "branding" | ...
  title: string               // i18n'd label
  defaultOpen: boolean         // caller-computed initial state (see §4)
  onOpenChange?: (open: boolean) => void
  children: React.ReactNode
}
```

- Header: chevron icon (rotates on open/close) + title, full-width clickable,
  keyboard-operable (Enter/Space), `aria-expanded` on the trigger.
- Uncontrolled internally (Radix `Collapsible` manages animation/open state)
  but reports changes via `onOpenChange` so the parent drawer can persist them.
- No badge/indicator for "has non-default values" — out of scope (YAGNI; can
  be added later if it turns out people miss sections with data in them).

## 4. Persistence

One `localStorage` key per drawer type, holding a flat map of section id →
open boolean, shared across every app (not keyed by app id) and not shared
across drawer types:

```
sa-app-drawer-sections:create  → { "branding": true, "security": false, ... }
sa-app-drawer-sections:edit    → { ... }
sa-app-drawer-sections:view    → { ... }
```

Resolving a section's initial `defaultOpen` when a drawer mounts:

1. If the drawer type's localStorage map has an entry for that section id,
   use it.
2. Otherwise fall back to the drawer type's hardcoded default:
   - **Edit:** all sections collapsed except `general`.
   - **Create:** all sections expanded.
   - **View:** all sections expanded.

Any toggle (open or close) immediately writes that drawer type's full map
back to `localStorage` (read-modify-write on toggle, not on drawer close —
so a toggle survives even if the user closes the drawer without saving/by
clicking outside). Writes are wrapped in try/catch (private browsing /
storage-disabled tabs must not break the toggle itself — see the artifact
`localStorage` guidance pattern: fail silently, section still toggles in
memory for that session).

A small shared hook, `useSectionPersistence(drawerType: 'create' | 'edit' | 'view')`,
owns the read/write/try-catch so each of the three drawers doesn't duplicate
it. Lives alongside the other admin-only hooks (e.g. `lib/use-copy-feedback.ts`'s
neighborhood) rather than in `@sassy-auth/ui`, since it's app-drawer-specific
(the id set and default-open rules are specific to this drawer family, not a
generic library concern).

## 5. Testing

- New `CollapsibleSection` unit tests in `packages/ui` (renders closed/open
  per `defaultOpen`, toggles on click, toggles on Enter/Space, calls
  `onOpenChange`, sets `aria-expanded` correctly).
- New `useSectionPersistence` unit tests in `apps/admin` (falls back to
  defaults when storage is empty, reads stored value when present, writes on
  toggle, swallows storage errors without throwing).
- Existing `app-edit-drawer.test.tsx`, `app-create-drawer.test.tsx`,
  `app-view-drawer.test.tsx` (if it has interaction tests) suites get updated:
  since Edit now starts with everything but `general` collapsed, any test
  touching a field outside `general` needs a `fireEvent.click` on that
  section's header first. Clear `localStorage` in `beforeEach` so tests don't
  leak state across cases.
- The four existing Password Policy section tests (`app-edit-drawer.test.tsx`,
  the `describe('password policy section', ...)` block) keep asserting the
  override-toggle behavior unchanged; only the outer section now needs an
  explicit expand click first, since `security` is collapsed by Edit's default.

## 6. Out of scope

- Per-app persistence (deliberately global-per-drawer-type, per the approved
  design discussion).
- Sharing persisted state across Create/Edit/View (deliberately separate
  per drawer type).
- Any "has data" badge/indicator on collapsed sections.
- Applying this pattern to the Org/Role/User drawers — `CollapsibleSection`
  is built generically enough to support that later, but no other drawer is
  touched by this spec.
