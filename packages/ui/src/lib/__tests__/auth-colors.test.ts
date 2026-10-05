import { isHexColor, buildAuthColorStyleSheet } from '../auth-colors'

describe('isHexColor', () => {
  it('accepts a valid 6-digit hex with #', () => {
    expect(isHexColor('#0F172A')).toBe(true)
  })
  it('rejects a value with no #', () => {
    expect(isHexColor('0F172A')).toBe(false)
  })
  it('rejects a 3-digit short hex', () => {
    expect(isHexColor('#FFF')).toBe(false)
  })
  it('rejects null/undefined', () => {
    expect(isHexColor(null)).toBe(false)
    expect(isHexColor(undefined)).toBe(false)
  })
  it('rejects a style-tag-breakout attempt', () => {
    expect(isHexColor('</style><script>window.__x=1</script>')).toBe(false)
  })
})

describe('buildAuthColorStyleSheet', () => {
  it('returns no css and no overrides when nothing is set', () => {
    const result = buildAuthColorStyleSheet({})
    expect(result.css).toBe('')
    expect(result.hasPageOverride).toBe(false)
    expect(result.hasCardOverride).toBe(false)
  })

  it('emits page/card background rules when only backgrounds are set (no text/button recolor without both page+card for that mode)', () => {
    const result = buildAuthColorStyleSheet({
      pageLightBackgroundColor: '#490080',
      cardDarkBackgroundColor: '#111111',
    })
    expect(result.hasPageOverride).toBe(true)
    expect(result.hasCardOverride).toBe(true)
    expect(result.css).toContain('[data-auth-page-bg]{background-color:#490080;}')
    expect(result.css).toContain('.dark [data-auth-card-bg]{background-color:#111111;}')
    // Neither mode has BOTH page+card set, so no text/button recolor rules at all.
    expect(result.css).not.toContain('--foreground')
    expect(result.css).not.toContain('.bg-primary')
  })

  it('emits light-mode text/button/error rules when light page+card are both set, independent of dark mode', () => {
    const result = buildAuthColorStyleSheet({
      pageLightBackgroundColor: '#490080', // luminance ~36 -> white contrast
      cardLightBackgroundColor: '#f4ebf9', // luminance ~239 -> black contrast
    })
    expect(result.css).toContain('[data-auth-card-bg]{--foreground:0 0% 0%;--card-foreground:0 0% 0%;--muted-foreground:0 0% 0%;--primary:0 0% 0%;--primary-foreground:0 0% 0%;}')
    expect(result.css).toContain('[data-auth-card-bg] .bg-primary{background-color:#FFFFFF;border:1.5px solid #000000;}')
    expect(result.css).toContain('[data-auth-card-bg] .text-destructive{color:#DC2626;}')
    expect(result.css).not.toContain('.dark [data-auth-card-bg]{--foreground')
  })

  it('emits dark-mode text/button/error rules scoped under .dark when dark page+card are both set', () => {
    const result = buildAuthColorStyleSheet({
      pageDarkBackgroundColor: '#ddb7ff', // luminance ~202 -> black contrast
      cardDarkBackgroundColor: '#490080', // luminance ~36 -> white contrast
    })
    expect(result.css).toContain('.dark [data-auth-card-bg]{--foreground:0 0% 100%;--card-foreground:0 0% 100%;--muted-foreground:0 0% 100%;--primary:0 0% 100%;--primary-foreground:0 0% 100%;}')
    expect(result.css).toContain('.dark [data-auth-card-bg] .bg-primary{background-color:#000000;border:1.5px solid #FFFFFF;}')
    expect(result.css).toContain('.dark [data-auth-card-bg] .text-destructive{color:#FB923C;}')
  })

  it('keeps button text legible when page and card land in the SAME contrast bucket', () => {
    // Both #1A1A2E (luminance ~28) and #16213E (luminance ~33) are well under
    // the 128 threshold, so both compute to white contrast -- the exact
    // same-bucket scenario that used to make the button render
    // white-text-on-white-background.
    const result = buildAuthColorStyleSheet({
      pageLightBackgroundColor: '#1A1A2E',
      cardLightBackgroundColor: '#16213E',
    })
    // Card text/foreground is white (card contrast), but the button's own
    // fill is also white (page contrast) -- so --primary-foreground must be
    // inverted (black) rather than matching --foreground, or the button
    // label would be invisible against its own background.
    expect(result.css).toContain('[data-auth-card-bg]{--foreground:0 0% 100%;--card-foreground:0 0% 100%;--muted-foreground:0 0% 100%;--primary:0 0% 100%;--primary-foreground:0 0% 0%;}')
    expect(result.css).toContain('[data-auth-card-bg] .bg-primary{background-color:#FFFFFF;')
  })

  it('treats a malformed color the same as unset (no crash, no rule for that side)', () => {
    const result = buildAuthColorStyleSheet({
      pageLightBackgroundColor: 'not-a-color',
      cardLightBackgroundColor: '#f4ebf9',
    })
    expect(result.hasPageOverride).toBe(false)
    expect(result.css).not.toContain('--foreground')
  })
})
