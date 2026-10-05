/**
 * Shared per-app auth-page color logic: hex validation, luminance-based
 * text/button contrast, and the CSS rules both `AuthCard`
 * (`../components/auth-card.tsx`) and the admin console's
 * `AuthBackgroundStyle` (for the two pages that hand-roll their own
 * page/card wrapper divs instead of using AuthCard) render. Centralized here
 * so the two call sites can't drift out of sync with each other.
 */

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

/**
 * Rejects anything that isn't a plain 6-digit hex color before it ever
 * reaches a <style> tag's raw text content. `<style>` is a raw-text HTML
 * element, so an unvalidated value containing e.g. `</style>` could
 * prematurely close the tag and let the rest be parsed as markup.
 */
export function isHexColor(value: string | null | undefined): value is string {
  return typeof value === 'string' && HEX_COLOR_PATTERN.test(value)
}

interface Contrast {
  hex: '#000000' | '#FFFFFF'
  hsl: '0 0% 0%' | '0 0% 100%'
}

const BLACK: Contrast = { hex: '#000000', hsl: '0 0% 0%' }
const WHITE: Contrast = { hex: '#FFFFFF', hsl: '0 0% 100%' }

/**
 * The button's own fill is `pageContrast` (see `.bg-primary` below), so its
 * label must contrast against THAT, not against the card's contrast color —
 * those two can land in the same bucket (e.g. a monochrome app where both
 * page and card are dark), which would otherwise render invisible
 * same-color-on-same-color button text.
 */
function invert(contrast: Contrast): Contrast {
  return contrast.hex === BLACK.hex ? WHITE : BLACK
}

/**
 * Standard luminance threshold (0-255 RGB scale): >128 is light enough for
 * black text/elements to read clearly; otherwise white reads better. No
 * WCAG contrast-ratio math — a simple binary choice, deliberately.
 */
function contrastOf(hex: string): Contrast {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b
  return luminance > 128 ? BLACK : WHITE
}

/**
 * Error/destructive text never uses the computed contrast color — a vivid
 * red or orange, chosen by which contrast bucket the card landed in, keeps
 * it reading as a warning instead of blending in as regular text. Mirrors
 * how this theme's own --destructive token already differs between light
 * and dark mode, just keyed off the card's contrast bucket instead of the
 * viewer's OS theme.
 */
function errorColorFor(cardContrast: Contrast): string {
  return cardContrast.hex === BLACK.hex ? '#DC2626' : '#FB923C'
}

export interface AuthColorOverrides {
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}

export interface AuthColorStyleSheet {
  css: string
  hasPageOverride: boolean
  hasCardOverride: boolean
}

/**
 * Builds every CSS rule the per-app background/text/button/error color
 * override needs, keyed off the `[data-auth-page-bg]` / `[data-auth-card-bg]`
 * attributes and the `.dark` class next-themes applies to <html>.
 *
 * Background rules apply independently per color that's set. Text/button/
 * error recoloring is stricter: it only activates for a given mode (light or
 * dark) when BOTH that mode's page and card colors are set — a page
 * background with no matching card color has nothing to compute contrast
 * against, so the default theme text/button colors are left alone.
 */
export function buildAuthColorStyleSheet({
  pageLightBackgroundColor,
  pageDarkBackgroundColor,
  cardLightBackgroundColor,
  cardDarkBackgroundColor,
}: AuthColorOverrides): AuthColorStyleSheet {
  const safePageLight = isHexColor(pageLightBackgroundColor) ? pageLightBackgroundColor : undefined
  const safePageDark = isHexColor(pageDarkBackgroundColor) ? pageDarkBackgroundColor : undefined
  const safeCardLight = isHexColor(cardLightBackgroundColor) ? cardLightBackgroundColor : undefined
  const safeCardDark = isHexColor(cardDarkBackgroundColor) ? cardDarkBackgroundColor : undefined

  const pageRules = [
    safePageLight && `[data-auth-page-bg]{background-color:${safePageLight};}`,
    safePageDark && `.dark [data-auth-page-bg]{background-color:${safePageDark};}`,
  ].filter(Boolean) as string[]
  const cardRules = [
    safeCardLight && `[data-auth-card-bg]{background-color:${safeCardLight};}`,
    safeCardDark && `.dark [data-auth-card-bg]{background-color:${safeCardDark};}`,
  ].filter(Boolean) as string[]

  const textRules: string[] = []

  if (safePageLight && safeCardLight) {
    const cardContrast = contrastOf(safeCardLight)
    const pageContrast = contrastOf(safePageLight)
    const errorColor = errorColorFor(cardContrast)
    textRules.push(
      `[data-auth-card-bg]{--foreground:${cardContrast.hsl};--card-foreground:${cardContrast.hsl};--muted-foreground:${cardContrast.hsl};--primary:${cardContrast.hsl};--primary-foreground:${invert(pageContrast).hsl};}`,
      `[data-auth-card-bg] .bg-primary{background-color:${pageContrast.hex};border:1.5px solid ${cardContrast.hex};}`,
      `[data-auth-card-bg] .text-destructive{color:${errorColor};}`,
    )
  }

  if (safePageDark && safeCardDark) {
    const cardContrast = contrastOf(safeCardDark)
    const pageContrast = contrastOf(safePageDark)
    const errorColor = errorColorFor(cardContrast)
    textRules.push(
      `.dark [data-auth-card-bg]{--foreground:${cardContrast.hsl};--card-foreground:${cardContrast.hsl};--muted-foreground:${cardContrast.hsl};--primary:${cardContrast.hsl};--primary-foreground:${invert(pageContrast).hsl};}`,
      `.dark [data-auth-card-bg] .bg-primary{background-color:${pageContrast.hex};border:1.5px solid ${cardContrast.hex};}`,
      `.dark [data-auth-card-bg] .text-destructive{color:${errorColor};}`,
    )
  }

  return {
    css: [...pageRules, ...cardRules, ...textRules].join(''),
    hasPageOverride: pageRules.length > 0,
    hasCardOverride: cardRules.length > 0,
  }
}
