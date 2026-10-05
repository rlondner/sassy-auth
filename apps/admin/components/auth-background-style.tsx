/**
 * Shared per-app page/card background color override styles.
 *
 * This duplicates the rule-building logic inside `AuthCard`
 * (`packages/ui/src/components/auth-card.tsx`): `TwoFactorForm` and
 * `TwoFactorPromptClient` hand-roll their own page/card wrapper `<div>`s
 * instead of using `AuthCard`, so they can't reuse the `<style>` block
 * `AuthCard` renders internally. If `auth-card.tsx`'s rule format (the
 * `[data-auth-page-bg]` / `[data-auth-card-bg]` selectors, the `.dark`
 * scoping, or the hex-validation regex) ever changes, this file must be
 * updated to match.
 */
export interface AuthBackgroundStyleProps {
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}

// Reject anything that isn't a plain 6-digit hex color before it ever reaches
// the <style> text content below. `<style>` is a raw-text HTML element, so an
// unvalidated value containing e.g. `</style>` could prematurely close the
// tag and let the rest be parsed as markup. Treat a malformed value the same
// as unset (no rule emitted for that side).
const isHexColor = (value: string | null | undefined): value is string =>
  typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

export function AuthBackgroundStyle({
  pageLightBackgroundColor,
  pageDarkBackgroundColor,
  cardLightBackgroundColor,
  cardDarkBackgroundColor,
}: AuthBackgroundStyleProps) {
  const safePageLight = isHexColor(pageLightBackgroundColor) ? pageLightBackgroundColor : undefined
  const safePageDark = isHexColor(pageDarkBackgroundColor) ? pageDarkBackgroundColor : undefined
  const safeCardLight = isHexColor(cardLightBackgroundColor) ? cardLightBackgroundColor : undefined
  const safeCardDark = isHexColor(cardDarkBackgroundColor) ? cardDarkBackgroundColor : undefined

  const pageRules = [
    safePageLight && `[data-auth-page-bg]{background-color:${safePageLight};}`,
    safePageDark && `.dark [data-auth-page-bg]{background-color:${safePageDark};}`,
  ].filter(Boolean)
  const cardRules = [
    safeCardLight && `[data-auth-card-bg]{background-color:${safeCardLight};}`,
    safeCardDark && `.dark [data-auth-card-bg]{background-color:${safeCardDark};}`,
  ].filter(Boolean)

  const allRules = [...pageRules, ...cardRules]
  if (allRules.length === 0) return null

  return <style>{allRules.join('')}</style>
}
