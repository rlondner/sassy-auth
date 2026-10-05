import { render } from '@testing-library/react'
import { AuthBackgroundStyle } from '../auth-background-style'

describe('AuthBackgroundStyle', () => {
  it('renders a style block with all 4 colors when set', () => {
    const { container } = render(
      <AuthBackgroundStyle
        pageLightBackgroundColor="#111111"
        pageDarkBackgroundColor="#222222"
        cardLightBackgroundColor="#333333"
        cardDarkBackgroundColor="#444444"
      />,
    )
    const style = container.querySelector('style')
    expect(style?.textContent).toContain('#111111')
    expect(style?.textContent).toContain('#444444')
  })

  it('renders nothing when no colors are set', () => {
    const { container } = render(<AuthBackgroundStyle />)
    expect(container.querySelector('style')).toBeNull()
  })

  it('silently ignores a malformed color value instead of breaking out of the style tag', () => {
    const { container } = render(
      <AuthBackgroundStyle pageLightBackgroundColor={'</style><script>window.__x=1</script>' as string} />,
    )
    expect(container.querySelector('style')).toBeNull()
    expect(container.querySelector('script')).toBeNull()
  })
})
