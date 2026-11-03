interface ProviderIconProps {
  className?: string
}

/**
 * Decorative brand icons for the social sign-in buttons (social-buttons.tsx).
 * <img>, not inline SVG — google.svg in particular is a complex gradient/
 * filter asset (~8.5KB); serving it as a static file avoids hand-transcribing
 * that markup into JSX and the bundle-size cost of inlining it. Sized via
 * `className` directly rather than Button's `[&_svg]:size-4` cascade, which
 * only targets inline <svg> descendants, not <img> tags — see design doc
 * 2026-11-02 §4.
 */
export function GoogleIcon({ className = 'size-4' }: ProviderIconProps) {
  return <img src="/icons/google.svg" alt="" aria-hidden="true" className={className} />
}

export function MicrosoftIcon({ className = 'size-4' }: ProviderIconProps) {
  return <img src="/icons/microsoft.svg" alt="" aria-hidden="true" className={className} />
}

/** Renders both theme variants; CSS (not JS) decides which one is visible, so
 * there's no hydration-mismatch risk the way a useTheme() hook would have. */
export function AppleIcon({ className = 'size-4' }: ProviderIconProps) {
  return (
    <>
      <img src="/icons/apple-light.svg" alt="" aria-hidden="true" className={`${className} dark:hidden`} />
      <img src="/icons/apple-dark.svg" alt="" aria-hidden="true" className={`${className} hidden dark:block`} />
    </>
  )
}
