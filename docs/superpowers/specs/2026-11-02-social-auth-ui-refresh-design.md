# Social sign-up/sign-in UI refresh — design

**Date:** 2026-11-02
**Status:** approved design, no implementation plan yet
**Scope:** restyle `/login`, `/signup` (plain form), and the `/signup` code-verification
wizard's email step to match the visual language of
[better-auth-ui's shadcn Storybook](https://better-auth-ui.com/storybook/shadcn/) Sign In /
Sign Up previews, and add branded icons (Google, Microsoft, Apple) to the social
sign-in buttons.

---

## 1. Reference and current state

The reference (captured live via Storybook) is a clean shadcn `Card`: bold centered
title, label-above-input fields, a full-width dark primary submit button, an "OR"
divider, and full-width bordered ("outline") social buttons — each with a provider
icon and `Continue with {Provider}` label, icon and label centered as a group within
the button.

Our codebase already shares the same shadcn primitive layer (`packages/ui`): `Card`,
`Button` (with an `outline` variant that already renders as a bordered white button —
`border border-input bg-background hover:bg-accent`), `FormField` (label-above-input,
built-in password show/hide toggle), and `AuthCard` (the centered-card page shell used
by eleven different auth pages). This is a **restyle + icon addition**, not a rebuild:
no new primitives are needed, only changes to how existing ones are composed and
styled on three specific pages.

The one real gap: `lucide-react` (the only icon package currently installed) has no
brand/logo icons. Google, Microsoft, and Apple marks need a new, small dependency.

## 2. Per-page layout

`AuthCard`'s title stays **centered** everywhere, including on the three pages this
work touches — no prop change to `AuthCard` itself, and no visual change to any of
the eight other pages that use it (forgot-password, reset-password, consent,
check-email, etc.).

Each social button renders its icon and label as a centered group inside a full-width
`outline`-variant button — this is already `Button`'s default behavior
(`items-center justify-center`) once an icon + text are passed as children, so no new
alignment styling is needed there either.

Ordering differs per page, because the forms differ wildly in length:

- **`/login`** (`login-form.tsx`) — short form, social buttons go *last*, matching the
  reference exactly:
  Email → Password → (existing error message, forgot-password/use-code links) →
  **Submit** → **OR** divider → social buttons.
- **`/signup`** plain form (`signup-form.tsx`) — long form (first/last name, optional
  company name, email, password + confirm, captcha, up to three consent checkboxes),
  so social buttons go *first* as a shortcut past all of that:
  social buttons → **OR** divider → first/last name → company name → email →
  password → confirm password → captcha → consent checkboxes → **Submit**.
- **`/signup` wizard, email step** (`signup-wizard.tsx`, `step === 'email'`) — captcha
  and the step's own Continue button stay anchored together at the bottom (captcha
  gates that step's submission), with the social shortcut placed between email and
  captcha:
  Email → captcha → **OR** divider → social buttons → **Continue**.

  Only the wizard's `'email'` step changes. The `'code'`, `'password'`, and `'name'`
  steps are mid-flow and keep offering no competing sign-up path, unchanged from
  today.

No other page using `AuthCard` is touched (forgot-password, reset-password, 2FA/
`login/code`, `login/consent`, `signup/check-email`, `signup/verified`).

## 3. Component changes

### `SocialButtons` (`apps/admin/components/social-buttons.tsx`)

- Each button's `variant` changes from `secondary` (filled gray) to `outline`
  (bordered white) — a one-line class change, matching the reference's button style.
- Each button gets a provider icon (see §4) rendered before the label text, inside the
  `Button`'s children — `Button`'s existing `[&_svg]:size-4 [&_svg]:shrink-0` CSS
  already sizes and constrains any SVG child consistently with how `lucide-react`
  icons are sized elsewhere in this button, so the icon component itself doesn't need
  to hardcode a size.
- **Stops rendering its own `OR` divider.** Today `SocialButtons` always renders the
  divider below its own buttons; since divider position now varies per page (after
  social on `/login`, before social on `/signup` and the wizard, sandwiched between
  captcha and social on the wizard) a single owned-internally divider can no longer
  satisfy every caller. The divider becomes a tiny new shared piece (see below) each
  page places explicitly around its `<SocialButtons>` call.
- Everything else about `SocialButtons` (the `providers`/`next`/`authServerUrl` props,
  the `/sign-in/social` POST flow, the empty-list-renders-nothing behavior) is
  unchanged.

### New: `AuthDivider` (`packages/ui` or `apps/admin/components`, naming TBD at
implementation time)

A tiny shared component wrapping the existing visual pattern (two `Separator` halves
+ centered label), extracted from `SocialButtons`'s current divider markup so all
three call sites render it identically. Takes the label text as a prop; keeps today's
existing copy key `socialDivider` (`"or continue with"`, already localized into
French) rather than switching to the reference's bare `"OR"` — no copy change, no new
translation work.

### New: provider icon components

A new file, `apps/admin/components/provider-icons.tsx`, exporting `GoogleIcon`,
`MicrosoftIcon`, `AppleIcon` as inline-SVG React components built from the brand
assets described in §4 — so `social-buttons.tsx` maps `provider → icon component`
through one small, local file rather than depending on the shape of an external
package.

## 4. Icon source: provided brand assets, no new dependency

Four official brand SVGs are provided in `designs/social/` at the repo root:
`google.svg` (Google's 2025 gradient "G" mark), `microsoft.svg` (the four-square
mark, flat brand colors), `apple_light.svg` and `apple_dark.svg` (the Apple glyph,
black-fill and white-fill respectively, for light/dark theme backgrounds). These are
copied into a new, hand-authored `apps/admin/components/provider-icons.tsx`, each as
an inline JSX `<svg>` component (`GoogleIcon`, `MicrosoftIcon`, `AppleIcon`) rather
than referenced as static `<img>` assets — inline SVG lets `Button`'s existing
`[&_svg]:size-4 [&_svg]:shrink-0` CSS size and constrain them consistently with how
`lucide-react` icons are already sized elsewhere in this button, which only targets
inline `<svg>` children, not `<img>` tags.

`AppleIcon` renders both the light and dark variants together, toggled with Tailwind's
`dark:`/`hidden` classes (`darkMode: 'class'` is already configured in
`packages/ui/tailwind.config.ts`) — the same CSS-only, no-JS, no-hydration-flash
pattern already relied on elsewhere for theme-aware rendering (e.g.
`auth-card.tsx`'s `.dark`-scoped `<style>` block), rather than a client-side
`useTheme()` hook that would need a mount guard and could flash the wrong variant
before hydration.

No new npm dependency is added. No provider beyond Google/Microsoft/Apple needs an
icon for this work — the existing `stub` provider (e2e test IdP) keeps its current
text-only button, since it's test-only infrastructure, not a real branded identity
provider a user would recognize.

## 5. What does NOT change

- `AuthCard`'s title alignment, logo rendering, footer, and color-override mechanism —
  untouched, and untouched on every page other than the three in scope.
- `FormField`'s label-above-input + password-toggle behavior — already matches the
  reference, no change needed.
- The `/sign-in/social` POST request flow, error handling, and redirect logic inside
  `SocialButtons`'s `start()` function — untouched.
- The `stub` provider's button — stays text-only, no icon.
- Any page other than `/login`, `/signup`, and the signup wizard's `'email'` step.

## 6. Testing

- **Unit (Jest + Testing Library):** existing suites (`social-buttons.test.tsx`,
  `login-form.test.tsx`, `signup-form.test.tsx`, `signup-wizard.test.tsx`) assert
  button presence/labels, not divider position — expected to need only minor updates
  (e.g. an added icon's accessible name/role, if the icon package renders one) rather
  than new test strategy. Any assertion that happens to depend on DOM order (divider
  before/after buttons) will need updating to match the new per-page ordering in §2.
- **Visual confirmation:** run the app locally (`pnpm dev`) and visually check all
  three pages against the reference screenshots captured during design, plus confirm
  the wizard's later steps (`code`/`password`/`name`) are visually unchanged.
- No new e2e coverage is anticipated — the existing stub-IdP e2e suite
  (`rs-social-round-trip.spec.ts`) already asserts the social button's accessible name
  (`/test idp/i`) and visibility conditions; those assertions are about the `stub`
  provider specifically (which keeps its text-only button) and should be unaffected by
  this purely visual change to the three real-provider buttons.

## 7. Out of scope

- Any page other than `/login`, `/signup`, and the wizard's email step (forgot/reset
  password, `/login/code`, consent, check-email, verified, link-expired, etc.) —
  these keep today's centered-title, no-social-button appearance unchanged.
- Changing `AuthCard`'s default title alignment — stays centered everywhere,
  confirmed during design (the reference's left-aligned title was considered and
  explicitly rejected in favor of keeping the current centered style).
- Any new identity provider beyond Google/Microsoft/Apple.
- Branded icon treatment for the `stub` e2e test provider.
