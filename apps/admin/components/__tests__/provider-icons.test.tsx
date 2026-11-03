import { render } from '@testing-library/react'
import { GoogleIcon, MicrosoftIcon, AppleIcon } from '../provider-icons'

describe('provider icons', () => {
  it('GoogleIcon renders the Google asset as a decorative image', () => {
    const { container } = render(<GoogleIcon />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/icons/google.svg')
    expect(img).toHaveAttribute('alt', '')
    expect(img).toHaveAttribute('aria-hidden', 'true')
  })

  it('MicrosoftIcon renders the Microsoft asset as a decorative image', () => {
    const { container } = render(<MicrosoftIcon />)
    const img = container.querySelector('img')
    expect(img).toHaveAttribute('src', '/icons/microsoft.svg')
    expect(img).toHaveAttribute('alt', '')
  })

  it('AppleIcon renders both light and dark variants, toggled via Tailwind dark: classes', () => {
    const { container } = render(<AppleIcon />)
    const imgs = container.querySelectorAll('img')
    expect(imgs).toHaveLength(2)
    expect(imgs[0]).toHaveAttribute('src', '/icons/apple-light.svg')
    expect(imgs[0]).toHaveClass('dark:hidden')
    expect(imgs[1]).toHaveAttribute('src', '/icons/apple-dark.svg')
    expect(imgs[1]).toHaveClass('hidden')
    expect(imgs[1]).toHaveClass('dark:block')
  })

  it('accepts a className override for custom sizing, defaulting to size-4', () => {
    const { container: defaultContainer } = render(<GoogleIcon />)
    expect(defaultContainer.querySelector('img')).toHaveClass('size-4')

    const { container } = render(<GoogleIcon className="h-6 w-6" />)
    expect(container.querySelector('img')).toHaveClass('h-6', 'w-6')
    expect(container.querySelector('img')).not.toHaveClass('size-4')
  })
})
