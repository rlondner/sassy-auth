import { buildAuthColorStyleSheet, type AuthColorOverrides } from '@sassy-auth/ui'

/**
 * Renders the same per-app background/text/button/error color override
 * `@sassy-auth/ui`'s AuthCard renders internally (see
 * `packages/ui/src/components/auth-card.tsx` and the shared
 * `packages/ui/src/lib/auth-colors.ts` module both of them now call), for
 * the two pages (`TwoFactorForm`, `TwoFactorPromptClient`) that hand-roll
 * their own page/card wrapper `<div>`s instead of using `AuthCard`.
 */
export type AuthBackgroundStyleProps = AuthColorOverrides

export function AuthBackgroundStyle(props: AuthBackgroundStyleProps) {
  const { css } = buildAuthColorStyleSheet(props)
  if (!css) return null
  return <style>{css}</style>
}
