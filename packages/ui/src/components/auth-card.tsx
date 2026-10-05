import * as React from 'react'
import { cn } from '../lib/utils'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './ui/card'

export interface AuthCardProps {
  title?: string
  subtitle?: string
  icon?: React.ReactNode
  logoUrl?: string | null
  /**
   * Accessible alt text for the logo image. `packages/ui` is a shared
   * component package with no i18n of its own, so callers on localized
   * pages (admin console's `/login` and `/signup`) must pass a translated
   * string here rather than this component hardcoding English. Defaults to
   * `''` (decorative/silent) for callers that don't provide one.
   */
  logoAlt?: string
  footer?: React.ReactNode
  className?: string
  children?: React.ReactNode
  /**
   * Per-app page/card background color overrides (6-digit hex), independent
   * per light/dark mode. Any combination may be set; an unset one falls
   * back to the existing bg-background/bg-card theme default. Rendered via
   * a scoped <style> block keyed off the `.dark` class next-themes already
   * applies to <html> (see theme-provider.tsx), so this needs no client JS
   * and has no FOUC.
   */
  pageLightBackgroundColor?: string | null
  pageDarkBackgroundColor?: string | null
  cardLightBackgroundColor?: string | null
  cardDarkBackgroundColor?: string | null
}

export function AuthCard({
  title,
  subtitle,
  icon,
  logoUrl,
  logoAlt = '',
  footer,
  className,
  children,
  pageLightBackgroundColor,
  pageDarkBackgroundColor,
  cardLightBackgroundColor,
  cardDarkBackgroundColor,
}: AuthCardProps) {
  const hasHeader = Boolean(title || subtitle || icon || logoUrl)

  // Reject anything that isn't a plain 6-digit hex color before it ever
  // reaches the <style> text content below. `<style>` is a raw-text HTML
  // element, so an unvalidated value containing e.g. `</style>` could
  // prematurely close the tag and let the rest be parsed as markup. Treat a
  // malformed value the same as unset (no rule emitted for that side).
  const isHexColor = (value: string | null | undefined): value is string =>
    typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)

  const safePageLight = isHexColor(pageLightBackgroundColor) ? pageLightBackgroundColor : undefined
  const safePageDark = isHexColor(pageDarkBackgroundColor) ? pageDarkBackgroundColor : undefined
  const safeCardLight = isHexColor(cardLightBackgroundColor) ? cardLightBackgroundColor : undefined
  const safeCardDark = isHexColor(cardDarkBackgroundColor) ? cardDarkBackgroundColor : undefined

  // Build one CSS rule per color that's actually set, keyed off the
  // `[data-auth-*-bg]` attribute and (for dark) the `.dark` class
  // next-themes applies to <html>. Rules render later in the document than
  // Tailwind's own stylesheet, so an attribute-selector rule here beats the
  // equal-specificity `.bg-background`/`.bg-card` utility class without
  // needing `!important`; an unset color just leaves that utility class in
  // charge, giving the existing theme default.
  const pageRules = [
    safePageLight && `[data-auth-page-bg]{background-color:${safePageLight};}`,
    safePageDark && `.dark [data-auth-page-bg]{background-color:${safePageDark};}`,
  ].filter(Boolean)
  const cardRules = [
    safeCardLight && `[data-auth-card-bg]{background-color:${safeCardLight};}`,
    safeCardDark && `.dark [data-auth-card-bg]{background-color:${safeCardDark};}`,
  ].filter(Boolean)
  const hasPageOverride = pageRules.length > 0
  const hasCardOverride = cardRules.length > 0

  return (
    <div
      className={cn('flex min-h-screen items-center justify-center bg-background p-6')}
      {...(hasPageOverride ? { 'data-auth-page-bg': '' } : {})}
    >
      {(hasPageOverride || hasCardOverride) && <style>{[...pageRules, ...cardRules].join('')}</style>}
      <Card
        className={cn('w-full max-w-sm', className)}
        {...(hasCardOverride ? { 'data-auth-card-bg': '' } : {})}
      >
        {hasHeader && (
          <CardHeader className="text-center">
            {logoUrl && (
              <div className="mb-4 flex justify-center">
                <img src={logoUrl} alt={logoAlt} className="max-h-12 object-contain" />
              </div>
            )}
            {icon && <div className="mb-4 flex justify-center">{icon}</div>}
            {title && <CardTitle className="text-headline-sm">{title}</CardTitle>}
            {subtitle && <CardDescription className="mt-1 text-body-sm">{subtitle}</CardDescription>}
          </CardHeader>
        )}
        {children && <CardContent className={hasHeader ? undefined : 'pt-6'}>{children}</CardContent>}
        {footer && <CardFooter className="flex flex-col gap-2 pt-0">{footer}</CardFooter>}
      </Card>
    </div>
  )
}
