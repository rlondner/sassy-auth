# Collapsible themed sections for the App drawers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the App Create/Edit/View drawers' flat field lists into themed, independently-collapsible sections, with per-drawer-type, localStorage-persisted open/closed state.

**Architecture:** A new stateless `CollapsibleSection` primitive in `@sassy-auth/ui` (built on `@radix-ui/react-collapsible`), driven by a new `useSectionPersistence` hook in `apps/admin/lib` that owns the open/closed map for a given drawer type and syncs it to `localStorage`. Each of the three app drawers wraps its existing field groups in `CollapsibleSection`s — no field logic changes, only the surrounding JSX structure.

**Tech Stack:** Next.js 15 (App Router) · React 19 · `@radix-ui/react-collapsible` (new dependency) · `lucide-react` (already a dependency) · next-intl · Jest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-05-app-drawer-collapsible-sections-design.md`

---

## Task 1: `CollapsibleSection` primitive (`@sassy-auth/ui`)

**Files:**
- Modify: `packages/ui/package.json` (add `@radix-ui/react-collapsible`)
- Create: `packages/ui/src/components/ui/collapsible-section.tsx`
- Create: `packages/ui/src/components/ui/__tests__/collapsible-section.test.tsx`
- Modify: `packages/ui/src/index.ts`

- [ ] **Step 1: Add the Radix dependency**

Run: `pnpm --filter @sassy-auth/ui add @radix-ui/react-collapsible`
Expected: `packages/ui/package.json`'s `dependencies` gains a `"@radix-ui/react-collapsible"` entry, `pnpm-lock.yaml` updates.

- [ ] **Step 2: Write the failing test**

Create `packages/ui/src/components/ui/__tests__/collapsible-section.test.tsx`:

```tsx
import * as React from 'react'
import { render, screen, fireEvent } from '@testing-library/react'
import { CollapsibleSection } from '../collapsible-section'

describe('CollapsibleSection', () => {
  it('renders children when open', () => {
    render(
      <CollapsibleSection title="Branding" open onOpenChange={() => undefined}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    expect(screen.getByText('Logo field')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Branding' })).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides children when closed', () => {
    render(
      <CollapsibleSection title="Branding" open={false} onOpenChange={() => undefined}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    expect(screen.queryByText('Logo field')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Branding' })).toHaveAttribute('aria-expanded', 'false')
  })

  it('calls onOpenChange with the toggled value when the header is clicked', () => {
    const onOpenChange = jest.fn()
    render(
      <CollapsibleSection title="Branding" open={false} onOpenChange={onOpenChange}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Branding' }))
    expect(onOpenChange).toHaveBeenCalledWith(true)
  })

  it('calls onOpenChange on Enter and Space keypresses', () => {
    const onOpenChange = jest.fn()
    render(
      <CollapsibleSection title="Branding" open onOpenChange={onOpenChange}>
        <p>Logo field</p>
      </CollapsibleSection>,
    )
    const trigger = screen.getByRole('button', { name: 'Branding' })
    fireEvent.keyDown(trigger, { key: 'Enter' })
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/ui test -- collapsible-section`
Expected: FAIL — `Cannot find module '../collapsible-section'`

- [ ] **Step 4: Implement `CollapsibleSection`**

Create `packages/ui/src/components/ui/collapsible-section.tsx`:

```tsx
'use client'

import * as React from 'react'
import * as CollapsiblePrimitive from '@radix-ui/react-collapsible'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/utils'

interface CollapsibleSectionProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  className?: string
}

const CollapsibleSection = React.forwardRef<HTMLDivElement, CollapsibleSectionProps>(
  ({ title, open, onOpenChange, children, className }, ref) => (
    <CollapsiblePrimitive.Root
      ref={ref}
      open={open}
      onOpenChange={onOpenChange}
      className={cn('rounded border border-border', className)}
    >
      <CollapsiblePrimitive.Trigger asChild>
        <button
          type="button"
          className="flex w-full items-center justify-between px-3 py-2 text-label-md font-semibold"
        >
          {title}
          <ChevronDown
            className={cn('h-4 w-4 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>
      </CollapsiblePrimitive.Trigger>
      <CollapsiblePrimitive.Content className="space-y-4 px-3 pb-3 pt-1">
        {children}
      </CollapsiblePrimitive.Content>
    </CollapsiblePrimitive.Root>
  ),
)
CollapsibleSection.displayName = 'CollapsibleSection'

export { CollapsibleSection }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/ui test -- collapsible-section`
Expected: PASS (4 tests)

- [ ] **Step 6: Export from the package index**

In `packages/ui/src/index.ts`, find the line `export { Separator } from './components/ui/separator'` and add immediately after it:

```ts
export { CollapsibleSection } from './components/ui/collapsible-section'
```

- [ ] **Step 7: Typecheck and commit**

Run: `pnpm --filter @sassy-auth/ui typecheck`
Expected: no errors

```bash
git add packages/ui/package.json packages/ui/src/components/ui/collapsible-section.tsx packages/ui/src/components/ui/__tests__/collapsible-section.test.tsx packages/ui/src/index.ts pnpm-lock.yaml
git commit -m "feat(ui): add CollapsibleSection primitive"
```

---

## Task 2: `useSectionPersistence` hook (`apps/admin`)

**Files:**
- Create: `apps/admin/lib/use-section-persistence.ts`
- Create: `apps/admin/lib/__tests__/use-section-persistence.test.tsx`

- [ ] **Step 1: Write the failing tests**

Create `apps/admin/lib/__tests__/use-section-persistence.test.tsx`:

```tsx
import { renderHook, act } from '@testing-library/react'
import { useSectionPersistence } from '../use-section-persistence'

beforeEach(() => {
  window.localStorage.clear()
})

describe('useSectionPersistence', () => {
  it('falls back to true for a section with no stored value and no override default', () => {
    const { result } = renderHook(() => useSectionPersistence('view', {}))
    expect(result.current.isOpen('branding')).toBe(true)
  })

  it('falls back to the supplied default when nothing is stored', () => {
    const { result } = renderHook(() => useSectionPersistence('edit', { branding: false }))
    expect(result.current.isOpen('branding')).toBe(false)
    expect(result.current.isOpen('general')).toBe(true)
  })

  it('setOpen updates isOpen immediately and persists to localStorage', () => {
    const { result } = renderHook(() => useSectionPersistence('edit', { branding: false }))
    act(() => {
      result.current.setOpen('branding', true)
    })
    expect(result.current.isOpen('branding')).toBe(true)
    expect(JSON.parse(window.localStorage.getItem('sa-app-drawer-sections:edit') ?? '{}')).toEqual({
      branding: true,
    })
  })

  it('a stored value overrides the supplied default on next mount', () => {
    window.localStorage.setItem('sa-app-drawer-sections:edit', JSON.stringify({ branding: true }))
    const { result } = renderHook(() => useSectionPersistence('edit', { branding: false }))
    expect(result.current.isOpen('branding')).toBe(true)
  })

  it('does not throw when localStorage.setItem fails', () => {
    const spy = jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const { result } = renderHook(() => useSectionPersistence('edit', {}))
    expect(() => {
      act(() => {
        result.current.setOpen('branding', true)
      })
    }).not.toThrow()
    expect(result.current.isOpen('branding')).toBe(true)
    spy.mockRestore()
  })

  it('keeps create/edit/view maps independent', () => {
    const editHook = renderHook(() => useSectionPersistence('edit', {}))
    act(() => {
      editHook.result.current.setOpen('branding', false)
    })
    const createHook = renderHook(() => useSectionPersistence('create', {}))
    expect(createHook.result.current.isOpen('branding')).toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sassy-auth/admin test -- use-section-persistence`
Expected: FAIL — `Cannot find module '../use-section-persistence'`

- [ ] **Step 3: Implement the hook**

Create `apps/admin/lib/use-section-persistence.ts`:

```ts
'use client'

import * as React from 'react'

export type SectionId = 'general' | 'branding' | 'security' | 'access' | 'credentials' | 'legal'
export type DrawerType = 'create' | 'edit' | 'view'

type SectionMap = Partial<Record<SectionId, boolean>>

function storageKey(drawerType: DrawerType): string {
  return `sa-app-drawer-sections:${drawerType}`
}

function readStored(drawerType: DrawerType): SectionMap {
  try {
    const raw = window.localStorage.getItem(storageKey(drawerType))
    return raw ? (JSON.parse(raw) as SectionMap) : {}
  } catch {
    return {}
  }
}

function writeStored(drawerType: DrawerType, map: SectionMap): void {
  try {
    window.localStorage.setItem(storageKey(drawerType), JSON.stringify(map))
  } catch {
    // Private browsing / storage-disabled tabs must not break the toggle —
    // the section still updates in memory for the rest of this session.
  }
}

/**
 * Owns the open/closed state for a drawer's CollapsibleSections, persisted to
 * localStorage per drawer type (shared across every app, not keyed by app id
 * — see the design spec). `defaults` supplies per-section overrides; any
 * section with neither a stored value nor a default entry opens by default.
 */
export function useSectionPersistence(drawerType: DrawerType, defaults: SectionMap) {
  const [stored, setStored] = React.useState<SectionMap>(() =>
    typeof window === 'undefined' ? {} : readStored(drawerType),
  )

  const isOpen = React.useCallback(
    (id: SectionId) => stored[id] ?? defaults[id] ?? true,
    [stored, defaults],
  )

  const setOpen = React.useCallback(
    (id: SectionId, open: boolean) => {
      setStored((prev) => {
        const next = { ...prev, [id]: open }
        writeStored(drawerType, next)
        return next
      })
    },
    [drawerType],
  )

  return { isOpen, setOpen }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sassy-auth/admin test -- use-section-persistence`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/admin/lib/use-section-persistence.ts apps/admin/lib/__tests__/use-section-persistence.test.tsx
git commit -m "feat(admin): add useSectionPersistence hook for app-drawer sections"
```

---

## Task 3: i18n — section titles

**Files:**
- Modify: `apps/admin/messages/en.json`
- Modify: `apps/admin/messages/fr.json`

- [ ] **Step 1: Add English section titles**

In `apps/admin/messages/en.json`, find (inside the `"apps"` object):

```json
      "passwordPolicyMinNumbers": "Minimum numbers",
      "passwordPolicyMinSpecial": "Minimum special characters"
    },
    "actions": {
```

Replace with:

```json
      "passwordPolicyMinNumbers": "Minimum numbers",
      "passwordPolicyMinSpecial": "Minimum special characters"
    },
    "sections": {
      "general": "General",
      "branding": "Branding",
      "security": "Sign-in & Security",
      "access": "Org Defaults & Social",
      "credentials": "Credentials & Webhooks",
      "legal": "Legal & Email"
    },
    "actions": {
```

- [ ] **Step 2: Add French section titles**

In `apps/admin/messages/fr.json`, find (inside the `"apps"` object):

```json
      "passwordPolicyMinNumbers": "Nombre minimum de chiffres",
      "passwordPolicyMinSpecial": "Nombre minimum de caractères spéciaux"
    },
    "actions": {
```

Replace with:

```json
      "passwordPolicyMinNumbers": "Nombre minimum de chiffres",
      "passwordPolicyMinSpecial": "Nombre minimum de caractères spéciaux"
    },
    "sections": {
      "general": "Général",
      "branding": "Image de marque",
      "security": "Connexion et sécurité",
      "access": "Organisation par défaut et social",
      "credentials": "Identifiants et webhooks",
      "legal": "Mentions légales et e-mail"
    },
    "actions": {
```

- [ ] **Step 3: Verify both files are still valid JSON**

Run: `node -e "JSON.parse(require('fs').readFileSync('apps/admin/messages/en.json','utf8')); JSON.parse(require('fs').readFileSync('apps/admin/messages/fr.json','utf8')); console.log('ok')"`
Expected: prints `ok`

- [ ] **Step 4: Commit**

```bash
git add apps/admin/messages/en.json apps/admin/messages/fr.json
git commit -m "feat(admin): add i18n for app-drawer section titles"
```

---

## Task 4: Wire sections into `AppEditDrawer`

**Files:**
- Modify: `apps/admin/components/app-edit-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-edit-drawer.test.tsx`

Six sections, defaults: `general` open, everything else closed (`EDIT_SECTION_DEFAULTS`).

- [ ] **Step 1: Import the new pieces and set up the hook**

In `apps/admin/components/app-edit-drawer.tsx`, find:

```tsx
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  ButtonGroup,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@sassy-auth/ui'
```

Replace with:

```tsx
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetHeader,
  SheetTitle,
  Button,
  ButtonGroup,
  CollapsibleSection,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@sassy-auth/ui'
```

Find:

```tsx
import { useCopyFeedback } from '@/lib/use-copy-feedback'
```

Replace with:

```tsx
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import { useSectionPersistence, type SectionId } from '@/lib/use-section-persistence'
```

Find (right before the component function):

```tsx
interface Props {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}
```

Replace with:

```tsx
const EDIT_SECTION_DEFAULTS: Partial<Record<SectionId, boolean>> = {
  branding: false,
  security: false,
  access: false,
  credentials: false,
  legal: false,
}

interface Props {
  app: App
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess?: () => void
}
```

Find the first hook declaration inside the component:

```tsx
  const [name, setName] = React.useState(app.name)
```

Replace with:

```tsx
  const { isOpen, setOpen } = useSectionPersistence('edit', EDIT_SECTION_DEFAULTS)
  const [name, setName] = React.useState(app.name)
```

- [ ] **Step 2: Wrap the `general` section (name, URL)**

Find:

```tsx
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="appName">{t('apps.fields.name')}</Label>
```

Replace with:

```tsx
          <form onSubmit={handleSubmit} className="space-y-4">
            <CollapsibleSection
              title={t('apps.sections.general')}
              open={isOpen('general')}
              onOpenChange={(open) => setOpen('general', open)}
            >
            <div>
              <Label htmlFor="appName">{t('apps.fields.name')}</Label>
```

Find:

```tsx
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            <div>
              <AppLogoField value={logo} onValueChange={setLogo} />
            </div>
```

Replace with:

```tsx
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
              />
            </div>
            </CollapsibleSection>
            <CollapsibleSection
              title={t('apps.sections.branding')}
              open={isOpen('branding')}
              onOpenChange={(open) => setOpen('branding', open)}
            >
            <div>
              <AppLogoField value={logo} onValueChange={setLogo} />
            </div>
```

- [ ] **Step 3: Close `branding`, open `security`**

Find:

```tsx
                label={t('apps.fields.cardDarkBackgroundColor')}
                hint={t('apps.fields.cardDarkBackgroundColorHint')}
              />
            </div>
            <div>
              <Label>{t('apps.fields.redirectUris')}</Label>
```

Replace with:

```tsx
                label={t('apps.fields.cardDarkBackgroundColor')}
                hint={t('apps.fields.cardDarkBackgroundColorHint')}
              />
            </div>
            </CollapsibleSection>
            <CollapsibleSection
              title={t('apps.sections.security')}
              open={isOpen('security')}
              onOpenChange={(open) => setOpen('security', open)}
            >
            <div>
              <Label>{t('apps.fields.redirectUris')}</Label>
```

- [ ] **Step 4: Close `security` (after the password-policy block), open `access`**

Find:

```tsx
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="defaultOrgId">{t('apps.fields.defaultOrg')}</Label>
```

Replace with:

```tsx
                </div>
              )}
            </div>
            </CollapsibleSection>
            <CollapsibleSection
              title={t('apps.sections.access')}
              open={isOpen('access')}
              onOpenChange={(open) => setOpen('access', open)}
            >
            <div>
              <Label htmlFor="defaultOrgId">{t('apps.fields.defaultOrg')}</Label>
```

- [ ] **Step 5: Close `access` (after social providers), open `credentials`**

Find:

```tsx
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="appPublicId">{t('apps.fields.publicId')}</Label>
```

Replace with:

```tsx
                </div>
              )}
            </div>
            </CollapsibleSection>
            <CollapsibleSection
              title={t('apps.sections.credentials')}
              open={isOpen('credentials')}
              onOpenChange={(open) => setOpen('credentials', open)}
            >
            <div>
              <Label htmlFor="appPublicId">{t('apps.fields.publicId')}</Label>
```

- [ ] **Step 6: Close `credentials` (after webhook secret), open `legal`**

Find:

```tsx
                  {(!app.activationWebhookUrl || webhookUrlDirty) && (
                    <p className="mt-1 text-body-sm text-muted-foreground">
                      {t('apps.fields.webhookSecretNeedsUrlHint')}
                    </p>
                  )}
                </div>
              )}
            </div>
            <div>
              <Label htmlFor="privacyPolicyUrl">{t('apps.fields.privacyPolicyUrl')}</Label>
```

Replace with:

```tsx
                  {(!app.activationWebhookUrl || webhookUrlDirty) && (
                    <p className="mt-1 text-body-sm text-muted-foreground">
                      {t('apps.fields.webhookSecretNeedsUrlHint')}
                    </p>
                  )}
                </div>
              )}
            </div>
            </CollapsibleSection>
            <CollapsibleSection
              title={t('apps.sections.legal')}
              open={isOpen('legal')}
              onOpenChange={(open) => setOpen('legal', open)}
            >
            <div>
              <Label htmlFor="privacyPolicyUrl">{t('apps.fields.privacyPolicyUrl')}</Label>
```

- [ ] **Step 7: Close `legal` (after email verification method, before the error/footer)**

Find:

```tsx
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.emailVerificationMethodHint')}
              </p>
            </div>
            {errorKey && (
```

Replace with:

```tsx
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.emailVerificationMethodHint')}
              </p>
            </div>
            </CollapsibleSection>
            {errorKey && (
```

- [ ] **Step 8: Typecheck**

Run: `pnpm --filter @sassy-auth/admin typecheck`
Expected: no errors (confirms every `<div>`/`</div>` and the six `<CollapsibleSection>`/`</CollapsibleSection>` pairs balance — a mismatch shows up as a JSX parse error here)

- [ ] **Step 9: Update the test file — add localStorage isolation**

In `apps/admin/components/__tests__/app-edit-drawer.test.tsx`, find:

```tsx
describe('AppEditDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
```

Replace with:

```tsx
describe('AppEditDrawer', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    window.localStorage.clear()
```

- [ ] **Step 10: Add a helper and expand sections touched by existing tests**

Directly below the `withIntl` helper function, add:

```tsx
function expandSection(sectionLabel: string) {
  fireEvent.click(screen.getByRole('button', { name: sectionLabel }))
}
```

The following existing tests interact with a field outside `general` (which stays open by default) and need one `expandSection(...)` call, inserted as the first line of the test body right after the `render(...)` call:

| Test (`it(...)` text) | Add before first interaction |
|---|---|
| `renders the publicId as read-only and copies on click` | `expandSection(en.apps.sections.credentials)` |
| `includes a changed logo in the update payload` | `expandSection(en.apps.sections.branding)` |
| `includes a changed favicon in the update payload` | `expandSection(en.apps.sections.branding)` |
| `backfills the logo from getAppAction and does not mark the form dirty from that alone` | `expandSection(en.apps.sections.branding)` |
| `backfills the favicon from getAppAction and does not mark the form dirty from that alone` | `expandSection(en.apps.sections.branding)` |
| `shows the no-login-URIs warning when the app has none registered` | `expandSection(en.apps.sections.security)` |
| `adds a redirect URI row, fills it in, and submits it in the patch` | `expandSection(en.apps.sections.security)` |
| `removes a redirect URI row` | `expandSection(en.apps.sections.security)` |
| `renders social sign-in checkboxes from the fetched list, checked by default` | `expandSection(en.apps.sections.access)` |
| `renders an unchecked checkbox for a provider the app has not enabled, allowing opt-in` | `expandSection(en.apps.sections.access)` |
| `unchecking a provider submits a providers array without it` | `expandSection(en.apps.sections.access)` |
| `shows "no client secret" for a public app and a Generate button` | `expandSection(en.apps.sections.credentials)` |
| `shows the rotation date and a Regenerate button for a confidential app` | `expandSection(en.apps.sections.credentials)` |
| `generating a client secret displays the plaintext once, with a copy control and warning` | `expandSection(en.apps.sections.credentials)` |
| `renders Default organization and Default role selects populated from this app's orgs/roles` | `expandSection(en.apps.sections.access)` |
| `includes defaultOrgId/defaultRoleId in the PATCH payload when changed` | `expandSection(en.apps.sections.access)` |
| `toggles allowOfflineAccess and includes it in the patch when changed` | `expandSection(en.apps.sections.security)` |
| `changes twoFactorPromptEnabled and includes it in the patch when changed` | `expandSection(en.apps.sections.security)` |
| `does not mark the form dirty when twoFactorPromptEnabled is re-selected to its current value` | `expandSection(en.apps.sections.security)` |
| `changes emailVerificationMethod and includes it in the patch when changed` | `expandSection(en.apps.sections.legal)` |
| `does not mark the form dirty when emailVerificationMethod is re-selected to its current value` | `expandSection(en.apps.sections.legal)` |
| `backfills emailVerificationMethod from getAppAction` | `expandSection(en.apps.sections.legal)` |
| `saves privacyPolicyUrl, termsUrl, and gdprUrl when edited` | `expandSection(en.apps.sections.legal)` |
| `clears a partially-set activationEmailOverride to null when the only field is emptied` | `expandSection(en.apps.sections.legal)` |

All four tests inside `describe('password policy section', ...)` (lines 645-738 before this change) need `expandSection(en.apps.sections.security)` as their first line too, since Password Policy lives inside `security`.

For each row above, find the test's `render(withIntl(<AppEditDrawer ... />))` (or, for tests that `await waitFor` immediately after render because of an async `getAppAction` backfill — e.g. the two "backfills..." tests — insert the `expandSection(...)` call right after that initial `waitFor`/render settles, before the test's first field interaction) and add the `expandSection(...)` line immediately after it. Example for the first row:

```tsx
  it('renders the publicId as read-only and copies on click', async () => {
    render(withIntl(<AppEditDrawer app={app} open onOpenChange={() => undefined} />))
    expandSection(en.apps.sections.credentials)
    const pubInput = screen.getByDisplayValue('sq_1') as HTMLInputElement
```

Apply the same one-line insertion pattern — `expandSection(en.apps.sections.<id>)` right after the render/settle point and before the first field interaction — to every other row in the table.

- [ ] **Step 11: Run the full test file**

Run: `pnpm --filter @sassy-auth/admin test -- app-edit-drawer`
Expected: PASS (all tests, including the 4 password-policy ones)

- [ ] **Step 12: Commit**

```bash
git add apps/admin/components/app-edit-drawer.tsx apps/admin/components/__tests__/app-edit-drawer.test.tsx
git commit -m "feat(admin): group AppEditDrawer fields into collapsible themed sections"
```

---

## Task 5: Wire sections into `AppCreateDrawer`

**Files:**
- Modify: `apps/admin/components/app-create-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-create-drawer.test.tsx`

Three sections (`general`, `branding`, `security`), all open by default — no entries needed in the defaults object (the hook's built-in fallback is already `true`).

- [ ] **Step 1: Import and set up the hook**

Find:

```tsx
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Button,
  ButtonGroup,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sassy-auth/ui'
```

Replace with:

```tsx
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  Button,
  ButtonGroup,
  CollapsibleSection,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@sassy-auth/ui'
```

Find:

```tsx
import { createAppAction } from '@/app/(admin)/apps/actions'
```

Replace with:

```tsx
import { createAppAction } from '@/app/(admin)/apps/actions'
import { useSectionPersistence } from '@/lib/use-section-persistence'
```

Find:

```tsx
export function AppCreateDrawer({ open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations()
```

Replace with:

```tsx
export function AppCreateDrawer({ open, onOpenChange, onSuccess }: Props) {
  const t = useTranslations()
  const { isOpen, setOpen } = useSectionPersistence('create', {})
```

- [ ] **Step 2: Wrap `general`, open `branding`**

Find:

```tsx
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <Label htmlFor="appName">{t('apps.fields.name')}</Label>
```

Replace with:

```tsx
          <form onSubmit={handleSubmit} className="space-y-4">
            <CollapsibleSection
              title={t('apps.sections.general')}
              open={isOpen('general')}
              onOpenChange={(open) => setOpen('general', open)}
            >
            <div>
              <Label htmlFor="appName">{t('apps.fields.name')}</Label>
```

Find:

```tsx
                placeholder="https://app.example.com"
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.urlHint')}
              </p>
            </div>
            <div>
              <AppLogoField value={logo} onValueChange={setLogo} />
            </div>
```

Replace with:

```tsx
                placeholder="https://app.example.com"
              />
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.urlHint')}
              </p>
            </div>
            </CollapsibleSection>
            <CollapsibleSection
              title={t('apps.sections.branding')}
              open={isOpen('branding')}
              onOpenChange={(open) => setOpen('branding', open)}
            >
            <div>
              <AppLogoField value={logo} onValueChange={setLogo} />
            </div>
```

- [ ] **Step 3: Close `branding`, open `security`**

Find:

```tsx
                label={t('apps.fields.cardDarkBackgroundColor')}
                hint={t('apps.fields.cardDarkBackgroundColorHint')}
              />
            </div>
            <div>
              <Label>{t('apps.fields.redirectUris')}</Label>
```

Replace with:

```tsx
                label={t('apps.fields.cardDarkBackgroundColor')}
                hint={t('apps.fields.cardDarkBackgroundColorHint')}
              />
            </div>
            </CollapsibleSection>
            <CollapsibleSection
              title={t('apps.sections.security')}
              open={isOpen('security')}
              onOpenChange={(open) => setOpen('security', open)}
            >
            <div>
              <Label>{t('apps.fields.redirectUris')}</Label>
```

- [ ] **Step 4: Close `security` (before the auto-generated-identifiers info box)**

Find:

```tsx
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.requireTwoFactorHint')}
              </p>
            </div>
            <div className="rounded border border-border bg-muted p-3 text-body-sm text-muted-foreground">
```

Replace with:

```tsx
              <p className="mt-1 text-body-sm text-muted-foreground">
                {t('apps.fields.requireTwoFactorHint')}
              </p>
            </div>
            </CollapsibleSection>
            <div className="rounded border border-border bg-muted p-3 text-body-sm text-muted-foreground">
```

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @sassy-auth/admin typecheck`
Expected: no errors

- [ ] **Step 6: Add localStorage isolation to the test file**

In `apps/admin/components/__tests__/app-create-drawer.test.tsx`, find the `describe('AppCreateDrawer', ...)` block's `beforeEach` (or add one immediately after the `describe(` line if none exists — check the file first). Add `window.localStorage.clear()` inside it, following the same pattern as Task 4 Step 9. No other test changes are needed — every section defaults open in Create.

- [ ] **Step 7: Run the full test file**

Run: `pnpm --filter @sassy-auth/admin test -- app-create-drawer`
Expected: PASS (all existing tests, unchanged assertions)

- [ ] **Step 8: Commit**

```bash
git add apps/admin/components/app-create-drawer.tsx apps/admin/components/__tests__/app-create-drawer.test.tsx
git commit -m "feat(admin): group AppCreateDrawer fields into collapsible themed sections"
```

---

## Task 6: Wire sections into `AppViewDrawer`

**Files:**
- Modify: `apps/admin/components/app-view-drawer.tsx`
- Modify: `apps/admin/components/__tests__/app-view-drawer.test.tsx`

Five sections (`general`, `branding`, `security`, `access`, `credentials` — no `legal`), all open by default.

- [ ] **Step 1: Import and set up the hook**

Find:

```tsx
import { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, Button, ButtonGroup, Badge } from '@sassy-auth/ui'
```

Replace with:

```tsx
import { Sheet, SheetBody, SheetClose, SheetContent, SheetHeader, SheetTitle, Button, ButtonGroup, Badge, CollapsibleSection } from '@sassy-auth/ui'
```

Find:

```tsx
import { useCopyFeedback } from '@/lib/use-copy-feedback'
```

Replace with:

```tsx
import { useCopyFeedback } from '@/lib/use-copy-feedback'
import { useSectionPersistence } from '@/lib/use-section-persistence'
```

Find:

```tsx
  const t = useTranslations()
  const { copiedKey: copied, copy } = useCopyFeedback()
```

Replace with:

```tsx
  const t = useTranslations()
  const { copiedKey: copied, copy } = useCopyFeedback()
  const { isOpen, setOpen } = useSectionPersistence('view', {})
```

- [ ] **Step 2: Wrap `general` (URL only)**

Find:

```tsx
        <SheetBody className="space-y-6">
          <DetailRow
            label={t('apps.fields.url')}
            value={displayApp.url}
            onCopy={() => copy(displayApp.url, 'url')}
            copied={copied === 'url'}
            copyLabel={t('apps.actions.copy')}
          />
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.logo')}</p>
```

Replace with:

```tsx
        <SheetBody className="space-y-6">
          <CollapsibleSection
            title={t('apps.sections.general')}
            open={isOpen('general')}
            onOpenChange={(open) => setOpen('general', open)}
          >
          <DetailRow
            label={t('apps.fields.url')}
            value={displayApp.url}
            onCopy={() => copy(displayApp.url, 'url')}
            copied={copied === 'url'}
            copyLabel={t('apps.actions.copy')}
          />
          </CollapsibleSection>
          <CollapsibleSection
            title={t('apps.sections.branding')}
            open={isOpen('branding')}
            onOpenChange={(open) => setOpen('branding', open)}
          >
          <div>
            <p className="text-label-sm font-bold uppercase tracking-wider text-muted-foreground">{t('apps.fields.logo')}</p>
```

- [ ] **Step 3: Close `branding`, open `security`**

Find:

```tsx
                )}
              </div>
            </div>
          )}
          <RedirectUriGroup
            label={t('apps.fields.loginRedirectUris')}
```

Replace with:

```tsx
                )}
              </div>
            </div>
          )}
          </CollapsibleSection>
          <CollapsibleSection
            title={t('apps.sections.security')}
            open={isOpen('security')}
            onOpenChange={(open) => setOpen('security', open)}
          >
          <RedirectUriGroup
            label={t('apps.fields.loginRedirectUris')}
```

- [ ] **Step 4: Close `security` (after password policy), open `access`**

Find:

```tsx
              </div>
            )}
          </div>
          <TextRow label={t('apps.fields.defaultOrg')} value={defaultOrgName ?? t('apps.fields.defaultOrgNone')} />
```

Replace with:

```tsx
              </div>
            )}
          </div>
          </CollapsibleSection>
          <CollapsibleSection
            title={t('apps.sections.access')}
            open={isOpen('access')}
            onOpenChange={(open) => setOpen('access', open)}
          >
          <TextRow label={t('apps.fields.defaultOrg')} value={defaultOrgName ?? t('apps.fields.defaultOrgNone')} />
```

- [ ] **Step 5: Close `access` (after social providers), open `credentials`**

Find:

```tsx
              )}
            </div>
          </div>
          <DetailRow
            label={t('apps.fields.publicId')}
```

Replace with:

```tsx
              )}
            </div>
          </div>
          </CollapsibleSection>
          <CollapsibleSection
            title={t('apps.sections.credentials')}
            open={isOpen('credentials')}
            onOpenChange={(open) => setOpen('credentials', open)}
          >
          <DetailRow
            label={t('apps.fields.publicId')}
```

- [ ] **Step 6: Close `credentials` (end of SheetBody)**

Find:

```tsx
          <TextRow
            label={t('apps.fields.webhookSecret')}
            value={displayApp.hasActivationWebhookSecret ? t('apps.fields.webhookSecretConfigured') : t('apps.fields.noWebhookSecret')}
          />
        </SheetBody>
```

Replace with:

```tsx
          <TextRow
            label={t('apps.fields.webhookSecret')}
            value={displayApp.hasActivationWebhookSecret ? t('apps.fields.webhookSecretConfigured') : t('apps.fields.noWebhookSecret')}
          />
          </CollapsibleSection>
        </SheetBody>
```

- [ ] **Step 7: Typecheck**

Run: `pnpm --filter @sassy-auth/admin typecheck`
Expected: no errors

- [ ] **Step 8: Add localStorage isolation to the test file**

In `apps/admin/components/__tests__/app-view-drawer.test.tsx`, find the `describe('AppViewDrawer', ...)` block's setup (check whether it already has a `beforeEach`; add one with `window.localStorage.clear()` if not, or add the line to the existing one — same pattern as Task 4 Step 9). No other test changes needed — every section defaults open in View.

- [ ] **Step 9: Run the full test file**

Run: `pnpm --filter @sassy-auth/admin test -- app-view-drawer`
Expected: PASS (all existing tests, unchanged assertions)

- [ ] **Step 10: Commit**

```bash
git add apps/admin/components/app-view-drawer.tsx apps/admin/components/__tests__/app-view-drawer.test.tsx
git commit -m "feat(admin): group AppViewDrawer fields into collapsible themed sections"
```

---

## Task 7: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run the full admin and ui test suites**

Run: `pnpm --filter @sassy-auth/admin test && pnpm --filter @sassy-auth/ui test`
Expected: PASS, no regressions outside the files touched above

- [ ] **Step 2: Run both packages' typecheck**

Run: `pnpm --filter @sassy-auth/admin typecheck && pnpm --filter @sassy-auth/ui typecheck`
Expected: no errors

- [ ] **Step 3: Lint**

Run: `pnpm --filter @sassy-auth/admin lint && pnpm --filter @sassy-auth/ui lint`
Expected: no errors. The manual `<CollapsibleSection>`/`</CollapsibleSection>` insertions in Tasks 4-6 don't re-indent the JSX they wrap — if lint enforces JSX indentation, fix any flagged lines (or run the project's formatter if one is configured) and amend the relevant task's commit.

- [ ] **Step 4: Manual smoke test**

Start the admin dev server (`pnpm --filter @sassy-auth/admin dev`) and in a browser:
1. Open Edit on an existing app — confirm only "General" is expanded; expand "Branding", close the drawer, reopen the same or a different app's Edit drawer — confirm "Branding" is still expanded (persistence).
2. Open Create — confirm General/Branding/Security are all expanded and there are only 3 sections (no Access/Credentials/Legal).
3. Open View — confirm all 5 sections (General/Branding/Security/Access/Credentials, no Legal) are expanded by default, and collapsing one in View does not affect Edit's independently-stored state.

- [ ] **Step 5: Report**

No commit for this task — it's verification only. If Step 3 surfaces an issue, fix it in the relevant task's file and amend that task's commit before moving on.
