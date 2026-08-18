# User Management UI — Design Spec

**Date:** 2026-05-26  
**Status:** Approved  
**Scope:** Platform admin UI — user management section (Users page, view drawer, create drawer)

---

## 1. Context

SassyAuth is a multitenant auth/authz server. The platform admin needs a web UI to manage users, orgs, apps, roles, and permissions. This spec covers the **user management section** of that admin console, including the monorepo structure and design system that will serve all five management sections.

The backend is a NestJS `auth-server` app (port 3000) with a fully-defined OpenAPI (`docs/api/openapi.yaml`). The admin UI calls it directly via BetterAuth session cookies.

---

## 2. Architecture

### Monorepo additions

```
apps/
  admin/                    — new Next.js App Router app
packages/
  ui/                       — new shared design system (shadcn/ui base)
```

### `apps/admin` structure

```
app/
  layout.tsx                — root layout: fonts, providers
  login/
    page.tsx                — unauthenticated entry point
  (admin)/                  — route group, guarded by middleware
    layout.tsx              — AdminShell (SideNav + main slot)
    users/page.tsx
    apps/page.tsx
    orgs/page.tsx
    roles/page.tsx
    permissions/page.tsx
components/                 — page-level compositions (drawers, tables)
lib/
  api.ts                    — typed fetch wrappers → auth-server
  locale.ts                 — next-intl helpers + locale list cache
messages/
  en.json
  fr.json
middleware.ts               — auth guard + locale detection (single pass)
```

### `packages/ui` structure

```
components/
  button.tsx
  badge.tsx
  sheet.tsx                 — base for all drawers
  data-table.tsx            — shadcn Table + TanStack sorting/filtering
  form-field.tsx
  user-avatar.tsx           — initials fallback, avatar image
  status-chip.tsx           — active / pending / inactive variants
  dropdown-menu.tsx
tailwind.config.ts          — Slate & Indigo tokens
globals.css                 — shadcn CSS variable mapping
```

All design system packages are published as `@sassy-auth/ui` within the pnpm workspace.

---

## 3. Design System

### Palette mapping — `packages/ui/globals.css`

shadcn/ui CSS variables mapped to Slate & Indigo tokens from `designs/palette-slate-indigo.md`:

```css
:root {
  --background:              #f8f9ff;   /* surface */
  --foreground:              #0b1c30;   /* on-surface */
  --card:                    #ffffff;   /* surface-container-lowest */
  --card-foreground:         #0b1c30;
  --primary:                 #3525cd;   /* primary */
  --primary-foreground:      #ffffff;
  --secondary:               #dae2fd;   /* secondary-container */
  --secondary-foreground:    #5c647a;
  --muted:                   #eff4ff;   /* surface-container-low */
  --muted-foreground:        #464555;   /* on-surface-variant */
  --border:                  #c7c4d8;   /* outline-variant */
  --ring:                    #3525cd;
  --destructive:             #ba1a1a;   /* error */
  --radius:                  0.25rem;   /* DEFAULT rounding */

  /* Custom tokens (not in shadcn defaults) */
  --sidebar-bg:              #213145;   /* inverse-surface */
  --sidebar-fg:              #e2dfff;   /* primary-fixed */
  --sidebar-active-fg:       #c3c0ff;   /* primary-fixed-dim */
  --sidebar-active-border:   #3525cd;   /* primary */
}
```

### Icons

**Material Symbols Outlined** — loaded via Google Fonts. Used as:
```tsx
<span className="material-symbols-outlined">group</span>
```
Filled variant set via `font-variation-settings: 'FILL' 1` on active nav items. No npm package required.

### Typography

**Manrope** via `next/font/google`. Applied as `font-sans` in Tailwind. Type scale from `palette-slate-indigo.md` extended in `packages/ui/tailwind.config.ts`:

| Token | Size | Weight | Line height |
|---|---|---|---|
| `text-headline-lg` | 30px | 700 | 36px |
| `text-headline-md` | 24px | 600 | 32px |
| `text-headline-sm` | 18px | 600 | 24px |
| `text-body-lg` | 16px | 400 | 24px |
| `text-body-md` | 14px | 400 | 20px |
| `text-body-sm` | 13px | 400 | 18px |
| `text-label-md` | 12px | 600 | 16px |
| `text-label-sm` | 11px | 700 | 14px |

### Status chips (`StatusChip` component)

Three variants on shadcn `Badge`:

| Variant | Background | Text | Dot | Meaning |
|---|---|---|---|---|
| `active` | `#dce9ff` (surface-container-high) | `#3525cd` (primary) | indigo | Signed up, can log in |
| `pending` | `#fef3c7` (amber-100) | `#92400e` (amber-800) | `#d97706` (amber-600) | Invited, not yet registered |
| `inactive` | `#ffdad6` (error-container) | `#93000a` (on-error-container) | `#ba1a1a` (error) | Disabled / deactivated |

---

## 4. Users Page (`/users`)

### Layout

Full-width table view using `AdminShell` (sidebar + main). No persistent side pane.

### `AdminShell` sidebar

- Dark background (`#213145`)
- Logo + "Admin Console" subtitle
- Language switcher (see §6) immediately below logo
- Nav items: Apps, Orgs, **Users** (active), Roles, Permissions
- Active item: 2px left border in `primary`, filled icon, `primary-fixed` text, subtle background tint
- Bottom: current user avatar (initials) + name + email + Sign Out action

### `UsersTable`

Built on `packages/ui/data-table.tsx` (shadcn `Table` + TanStack Table for sorting/filtering).

**Columns:**
| Column | Component | Notes |
|---|---|---|
| User | `UserAvatar` + name + email | Avatar = initials if no image |
| Status | `StatusChip` | `active` / `pending` / `inactive` |
| Org | plain text | org name from `orgId` lookup |
| Last Login | plain text | relative time; "Never" for pending users |
| Actions | `DropdownMenu` | Edit, Reset Password, Activate/Deactivate, Delete |

**Header bar:**
- Page title "Users" (headline-md)
- Search input (searches name + email client-side via TanStack)
- Filter button (future: filter by status/org)
- "Add User" primary button → opens `UserCreateDrawer`

**Row interaction:**
- Hover: `surface-container-highest` background + 2px `primary` left indicator
- Click anywhere on row (except `···` button) → opens `UserViewDrawer`

**Data loading:** Server Component fetches `GET /api/users` on page load. Result passed as prop to the client-side `UsersTable`.

---

## 5. UserViewDrawer

Implemented with shadcn `Sheet` (side variant, ~52% viewport width).

**Trigger:** clicking any user row in the table.

**Data fetched on open** (three parallel requests):
1. `GET /api/users/{id}` — profile fields
2. `GET /api/users/{id}/roles` — assigned roles
3. `GET /api/users/{id}/effective-permissions` — flat permission list

**Structure:**

### Drawer header
- User full name + email
- "Reset Password" secondary button
- "Edit" primary button — switches the profile card fields (First Name, Last Name, Phone, Username) from read-only text to inline inputs; header buttons change to "Save" (primary) and "Cancel" (secondary); submits via `PATCH /api/users/{id}`
- Close (×) button

### Profile card
- Gradient banner (indigo → purple, from `users-mgmt-preview` design)
- Large avatar (initials, 48×48, rounded-lg, white border, overlapping banner)
- Full name, email with mail icon
- `StatusChip` (top-right)
- Info grid: First Name, Last Name, User ID (monospace `code` chip)
- Account status box: Last Login (with timestamp), Created date

### Organization & Access section
- Section header + "Grant Access" link button
- One org card per org the user belongs to (currently one per PRD, but card-based for future extensibility):
  - Org name + "Primary" badge + Sqid + app link
  - `···` menu (future: remove from org)
  - **Assigned Roles** column: role pills (purple tint)
  - **Effective Permissions** column: permission chips (bordered), count badge, "+ N more" expand

---

## 6. UserCreateDrawer

Same shadcn `Sheet` component, different content. Triggered by "Add User" in the header bar.

**No password at creation time.** The admin never sets a password. Instead, the backend generates a unique invitation token and returns the invitation link. The admin copies it and shares it with the user (out of scope: email delivery). The user clicks the link, lands on `/accept-invite`, and sets their own password.

**Structure:**

### Drawer header
- "New User" title + subtitle
- Close (×) button

### Form body (scrollable)

**Section: Basic Information**
- First Name (required)
- Last Name (required)
- Email Address (required)
- Username (optional)
- Phone Number (optional)

**Section: Access & Permissions**
- Organization — `Select` populated from `GET /api/orgs` (loaded server-side, passed as prop)
- Role — `Select` populated from `GET /api/roles?appId={selectedOrgAppId}` (loaded client-side on org change)

### Footer actions
- Cancel (secondary) — closes drawer
- Create User & Generate Invite (primary) — submits Server Action

**Server Action behavior:**
1. Validates form fields
2. Calls `POST /api/users` with `{ firstName, lastName, email, orgId, username?, phoneNumber? }` — no password
3. Assigns the selected role via `POST /api/users/{id}/roles`
4. On success: drawer transitions to a **confirmation state** showing:
   - "User created — share this invitation link:" 
   - The full invitation URL in a read-only input with a one-click copy button
   - "Done" button closes drawer and calls `revalidatePath('/users')`
5. On error: surfaces inline error message in drawer (e.g. email already exists)

**New user status:** `pending` on creation (no credentials yet). Becomes `active` when the user accepts the invite and sets their password.

### Resend Invitation

The `···` dropdown on a `pending` user row includes a **"Resend Invitation"** action. This calls `POST /api/users/{id}/resend-invitation`, which:
1. Invalidates all existing unused tokens for that user
2. Generates a new `SaInvitation` token
3. Returns the new invitation URL for display in a toast with a copy button

### `/accept-invite` page (outside `(admin)` route group — unauthenticated)

Route: `app/accept-invite/page.tsx`

1. Reads `?token=` query param
2. Calls `GET /api/invitations/{token}` — validates token, returns `{ firstName, email, expired: boolean }`
3. If expired or invalid: shows error state with "Request a new invite" message
4. If valid: shows "Set your password" form (password + confirm password)
5. On submit: calls `POST /api/invitations/{token}/accept` with `{ password }`
6. On success: BetterAuth creates the `Account` row with hashed password; `SaUser.status` → `active`; redirect to `/login`

---

## 7. i18n

**Library:** `next-intl` (no URL locale prefix)

### Locale detection (middleware)
```
NEXT_LOCALE cookie present? → use it
  else → parse Accept-Language header → match against available locales
  else → default to 'en'
→ set NEXT_LOCALE cookie if absent
→ pass locale to next-intl requestLocale
```

### Available locales discovery
A server-side cached helper (`lib/locale.ts`) reads `messages/*.json` filenames once at startup using `fs.readdirSync`. The result is stable for the lifetime of the process. This list is passed as a prop to the `LocaleSwitcher` client component.

### Language switcher (in sidebar)
```
[language icon]  EN  [chevron]
```
- Renders available locales as a dropdown (shadcn `DropdownMenu`)
- Selecting a locale calls a Server Action: sets `NEXT_LOCALE` cookie, calls `redirect()` to current path
- Matches the design in `designs/users-mgmt-preview_fr/code.html`

### Message file structure (`messages/en.json`)
```json
{
  "nav": {
    "apps": "Apps", "orgs": "Orgs", "users": "Users",
    "roles": "Roles", "permissions": "Permissions",
    "support": "Support", "signOut": "Sign Out",
    "directory": "Directory", "accessControl": "Access Control"
  },
  "users": {
    "title": "Users",
    "search": "Search users…",
    "addUser": "Add User",
    "columns": {
      "user": "User", "status": "Status",
      "org": "Org", "lastLogin": "Last Login", "actions": "Actions"
    },
    "status": { "active": "Active", "pending": "Pending", "inactive": "Inactive" },
    "drawer": {
      "viewTitle": "User Details",
      "createTitle": "New User",
      "createSubtitle": "Add a user and assign initial org + role.",
      "basicInfo": "Basic Information",
      "accessPerms": "Access & Permissions",
      "create": "Create User", "cancel": "Cancel",
      "edit": "Edit", "resetPassword": "Reset Password",
      "grantAccess": "Grant Access",
      "assignedRoles": "Assigned Roles",
      "effectivePermissions": "Effective Permissions",
      "nMorePermissions": "+ {count} more"
    },
    "fields": {
      "firstName": "First Name", "lastName": "Last Name",
      "email": "Email Address", "username": "Username",
      "phone": "Phone Number", "optional": "(optional)",
      "org": "Organization", "role": "Role",
      "userId": "User ID", "lastLogin": "Last Login", "created": "Created",
      "never": "Never", "today": "Today at {time}", "primary": "Primary"
    },
    "actions": {
      "edit": "Edit", "resetPassword": "Reset Password",
      "deactivate": "Deactivate", "activate": "Activate", "delete": "Delete"
    }
  }
}
```

`messages/fr.json` mirrors the same structure with French strings.

---

## 8. Auth

### Login page (`/login`)
- Centered card: email + password fields
- Server Action calls `POST /api/auth/sign-in/email` on auth-server
- Success: BetterAuth sets `better-auth.session_token` cookie; redirect to `/users`
- Failure: inline error (invalid credentials / account inactive)

### Middleware guard
`middleware.ts` runs on every request to the `(admin)` route group:
1. Check `better-auth.session_token` cookie — absent → redirect to `/login?next=<path>`
2. Detect/set `NEXT_LOCALE` cookie (runs regardless of auth state)

### Session forwarding
All `fetch()` calls in Server Components and Server Actions forward the session cookie explicitly using `cookies()` from `next/headers`:
```ts
import { cookies } from 'next/headers'

const cookieStore = await cookies()
fetch('http://localhost:3000/api/users', {
  headers: { Cookie: cookieStore.toString() },
})
```
`credentials: 'include'` is browser-only and does not work in Next.js server-side fetch. `lib/api.ts` wraps this pattern so all callers get it automatically.

### Sign out
Sidebar "Sign Out" triggers a Server Action: calls `POST /api/auth/sign-out`, then `redirect('/login')`.

### Note on JWT
The JWT issuance endpoints (`/api/token/*`) are for resource servers authenticating end users — not used by the admin console itself.

---

## 9. Database Schema Changes (`packages/db/schema.prisma`)

### Add `UserStatus` enum and `status` field to `SaUser`

`status` lives on `SaUser` (the SassyAuth extension), not on BetterAuth's `User` table.

```prisma
enum UserStatus {
  active
  pending
  inactive
}

model SaUser {
  // ... existing fields ...
  status      UserStatus   @default(pending)
  invitations SaInvitation[]
}
```

### Add `SaInvitation` model

```prisma
model SaInvitation {
  id        Int       @id @default(autoincrement())
  publicId  String    @unique               // Sqid
  token     String    @unique               // 32-byte cryptographically random hex — used in the URL
  userId    Int
  user      SaUser    @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime                        // default: now + 7 days
  usedAt    DateTime?                       // null = not yet accepted
  createdAt DateTime  @default(now())

  @@index([token])
  @@index([userId])
}
```

**Notes:**
- The `token` is raw random bytes (e.g. `crypto.randomBytes(32).toString('hex')`) — never encrypted, never stored hashed. It is long enough (256 bits) to be unguessable and is transmitted only over HTTPS. It is single-use (`usedAt` set on acceptance) and expires after 7 days.
- BetterAuth stores the hashed password in its `Account` table. At creation time no `Account` row is created for the user. The `POST /api/invitations/{token}/accept` endpoint calls BetterAuth's sign-up to create the `Account` row when the user sets their password.
- A migration file must be added under `packages/db/migrations/`.

---

## 10. API Extensions Required

The existing `openapi.yaml` requires the following additions:

### `User` schema — add `status`
```yaml
status:
  type: string
  enum: [active, pending, inactive]
  description: >
    active — signed up and enabled;
    pending — invited, has not accepted invite yet;
    inactive — disabled by admin
```

### `CreateUserRequest` — remove `password`
`password` is no longer accepted. The backend generates the invitation token automatically.

### `UpdateUserRequest` — add `status`
```yaml
status:
  type: string
  enum: [active, inactive]
  description: Activate or deactivate the user. Cannot be set to pending via this endpoint.
```

### New: `Invitation` schema
```yaml
Invitation:
  type: object
  properties:
    token:     { type: string }
    inviteUrl: { type: string, description: "Full URL for the accept-invite page" }
    expiresAt: { type: string, format: date-time }
  required: [token, inviteUrl, expiresAt]
```

### New endpoints

**`POST /api/users/{id}/resend-invitation`**
- Requires `platform.users.manage` or `org.users.manage`
- Invalidates all existing unused tokens for the user
- Creates a new `SaInvitation`, returns `Invitation`
- 400 if user is already `active` or `inactive`

**`GET /api/invitations/{token}`**
- Public (no auth required)
- Returns `{ firstName, email, expired: boolean }`
- 404 if token does not exist

**`POST /api/invitations/{token}/accept`**
- Public (no auth required)
- Body: `{ password: string }` (min 8 chars)
- Validates token not expired and not already used
- Calls BetterAuth internally to create the `Account` credential row
- Sets `SaUser.status = active`, `SaInvitation.usedAt = now()`, `User.emailVerified = true`
- Returns 204 on success; 400 if token expired/used; 422 if password too weak

---

## 11. Out of Scope (this spec)

- Apps, Orgs, Roles, Permissions management pages (same `packages/ui` components, separate specs)
- Email delivery of invitation links (infrastructure TBD — link is displayed in UI for now)
- Password reset email flow
- Social provider management per user
- Pagination / infinite scroll on the users table (can be added once real data volume is known)
- Dark mode
