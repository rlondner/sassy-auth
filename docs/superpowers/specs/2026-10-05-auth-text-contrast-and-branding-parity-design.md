# Computed text/button contrast colors + logo/favicon parity on auth pages

## Problem

The per-app background color override feature (previously shipped) lets admins
set 4 hex colors (page/card × light/dark) on their app's hosted auth pages.
It does not touch text or button colors — when an admin picks colors far from
the default theme (e.g. VibeCast's dark-purple-on-near-white light mode), the
existing fixed text/button colors can become illegible or disappear entirely
against the new background. Separately, an audit of the 10 auth pages found
logo and favicon branding is inconsistently applied — only 2 of 10 pages show
both; most show neither.

A mockup against VibeCast's real configured colors (`pageLightBackgroundColor:
#490080`, `pageDarkBackgroundColor: #ddb7ff`, `cardLightBackgroundColor:
#f4ebf9`, `cardDarkBackgroundColor: #490080`) confirmed the illegibility risk
concretely: a naive "contrast of the background" button in light mode landed
on white-on-near-white, nearly invisible. That mockup, after two rounds of
refinement (button outline, dedicated error color), is approved as the basis
for this spec.

## Section A — Computed text/button contrast colors

### Activation

Evaluated **per mode, independently**. Light-mode recoloring activates only
when both `pageLightBackgroundColor` and `cardLightBackgroundColor` are set;
dark-mode recoloring activates only when both dark-mode colors are set. An app
with only light-mode colors configured gets the light-mode treatment and
default theme colors in dark mode.

### Contrast calculation

Standard luminance threshold on the relevant hex color (0–255 RGB scale):

```
luminance = 0.299·R + 0.587·G + 0.114·B
```

`luminance > 128` → black (`#000000`); otherwise → white (`#FFFFFF`). Applied
independently to the active page color (→ `pageContrast`) and the active card
color (→ `cardContrast`). No WCAG contrast-ratio computation, no alpha
blending — a simple binary threshold, consistent with the rest of this
feature's "good enough, not a color-science engine" posture.

### What uses which contrast

- **`cardContrast`** drives *all* text inside the card: title, subtitle, body
  copy, field labels, hints, links, and button label text. This is the
  Tailwind theme variables `--foreground`, `--card-foreground`,
  `--muted-foreground`, `--primary` (drives link color via `text-primary`),
  and `--primary-foreground` (drives button label color via
  `text-primary-foreground`) — all overridden to the same `cardContrast` HSL
  triplet (e.g. `0 0% 0%` for black, `0 0% 100%` for white), scoped under
  `[data-auth-card-bg]` (and `.dark [data-auth-card-bg]` for the dark-mode
  values), exactly mirroring how the background-color override itself is
  already scoped.
- **`pageContrast`** drives the button's own *background* only. Overriding
  `--primary` for link-text purposes would, by itself, also recolor the
  button background (`bg-primary` resolves the same variable) — so the
  button's background is additionally force-set with a literal,
  higher-priority rule: `[data-auth-card-bg] .bg-primary { background-color:
  <pageContrast hex> }`. Because this is a direct (unlayered) CSS rule rather
  than another variable-driven utility class, it wins over the var-driven
  `.bg-primary` background regardless of what `--primary` resolves to for
  link-text purposes elsewhere in the card — the same "unlayered beats
  `@layer utilities`" cascade rule the background-color override already
  relies on.
- **Button border:** every button gets a `1.5px solid <cardContrast hex>`
  border via the same rule that sets its background, so the button stays
  visually distinct from the card even when its fill color happens to be
  close to the card's own color (VibeCast's light mode is exactly this case).
- **Error text** does **not** use either computed contrast. See below.

### Error text: dedicated color, not computed contrast

Error/destructive text (`.text-destructive`) is excluded from the "all text"
rule and instead gets a fixed, vivid color chosen by which `cardContrast`
bucket is active — the same bucket decision already computed, no extra work:

- `cardContrast` is black (light card) → error text `#DC2626` (vivid red)
- `cardContrast` is white (dark card) → error text `#FB923C` (vivid orange)

This mirrors how the theme's existing `--destructive` token already differs
between its light-mode and dark-mode values in `globals.css` — picking a
mode-appropriate shade rather than one fixed color, just gated on the card's
contrast bucket instead of the viewer's OS theme.

### Accepted tradeoffs

- The button's `hover:bg-primary/90` dimming effect is suppressed while this
  override is active (the literal `background-color` override has no hover
  variant). Buttons become static-colored instead of dimming on hover. Not
  worth the added complexity to preserve.
- No change to `--ring` (focus-visible outline color) — left at the default
  theme value.
- No per-field validation/encouragement colors, success-state green, etc. are
  touched — only the destructive/error class and the general text/button
  colors described above.

### Where this lives

Both `AuthCard` (`packages/ui/src/components/auth-card.tsx`) and the
two-factor pages' duplicate `AuthBackgroundStyle`
(`apps/admin/components/auth-background-style.tsx`) need this logic. Since
both files are being touched anyway, the hex-validation + contrast-calculation
+ CSS-rule-building logic is extracted into one new exported helper module in
`packages/ui` (e.g. `packages/ui/src/lib/auth-colors.ts`), imported by both —
closing the duplication gap between the two files that a prior code review
flagged as low-priority and non-blocking, now that there's a second reason
(more logic, more drift risk) to actually fix it.

## Section B — Logo and favicon parity across all 10 pages

Audit of current state:

| Page | Logo today | Favicon today |
|---|---|---|
| `/login` | yes | yes |
| `/signup` | yes | yes |
| `/signup/check-email` | no | no |
| `/signup/verified` + link-expired | no | no |
| `/login/code` (OTP) | yes | no |
| `/login/two-factor` | no | no |
| `/login/two-factor-prompt` | no | no |
| `/login/consent` | no | no |
| `/forgot-password` | yes | no |
| `/reset-password` | no | no |

### Logo

Add `logoUrl` (routed through to `AuthCard`'s existing prop) to the 6 pages
missing it: check-email, verified/link-expired, two-factor, two-factor-prompt,
consent, reset-password. For the 4 of those that already use `AuthCard`
(check-email, verified/link-expired, consent, reset-password), this is purely
threading an already-fetched `logo` value (from `fetchAppBranding`, already
in scope on these pages for the background-color feature) into the existing
`<AuthCard>` call. For the 2 that don't use `AuthCard` (two-factor,
two-factor-prompt), a small header block (just the `<img>`, no title/subtitle
— those pages keep their own hand-rolled title markup) is added above the
existing content, matching `AuthCard`'s own logo-rendering markup
(`max-h-12 object-contain`, centered, in a `mb-4` wrapper).

### Favicon

Add a `generateMetadata` export to the 8 pages missing it, following the
exact pattern already used by `/login` and `/signup`: fetch branding a second
time (Next.js App Router's `generateMetadata` runs in a separate render pass
from the page component, so it can't share the page body's fetch) and return
`icons: { icon: favicon }` when present. For the pages reached via a `next`
URL rather than an explicit `client_id`/`appPublicId` param (OTP, two-factor,
two-factor-prompt), `generateMetadata` parses `client_id` out of `next` via
the existing `clientIdFromNext` helper, same as the page body already does.

## Out of scope

- No WCAG contrast-ratio computation — binary luminance threshold only.
- No admin-configurable override for text, button, or error colors — these
  are derived, not independently settable.
- No retrofit of `two-factor`/`two-factor-prompt` onto the shared `AuthCard`
  component itself — they keep their own hand-rolled markup, just gain the
  same derived colors and a logo via direct, page-local styling.
- No change to focus-ring, success, or other semantic colors beyond
  `--foreground`/`--card-foreground`/`--muted-foreground`/`--primary`/
  `--primary-foreground` and the dedicated error-text color.
