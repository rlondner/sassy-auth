import { render, screen } from '@testing-library/react'
import { AuthCard } from '../components/auth-card'

describe('AuthCard', () => {
  it('renders the title and subtitle', () => {
    render(
      <AuthCard title="Sign in" subtitle="Welcome back">
        content
      </AuthCard>,
    )
    expect(screen.getByRole('heading', { name: 'Sign in' })).toBeInTheDocument()
    expect(screen.getByText('Welcome back')).toBeInTheDocument()
    expect(screen.getByText('content')).toBeInTheDocument()
  })

  it('renders an icon above the title when provided', () => {
    render(
      <AuthCard title="Verified" icon={<span data-testid="icon">check</span>}>
        content
      </AuthCard>,
    )
    expect(screen.getByTestId('icon')).toBeInTheDocument()
  })

  it('renders a logo image above the title when logoUrl is provided, using the caller-supplied alt text', () => {
    render(
      <AuthCard title="Sign in" logoUrl="data:image/png;base64,AAA=" logoAlt="Acme logo">
        content
      </AuthCard>,
    )
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', 'data:image/png;base64,AAA=')
    expect(img).toHaveAttribute('alt', 'Acme logo')
  })

  it('defaults the logo alt text to an empty string when logoAlt is not provided', () => {
    // An <img alt=""> is treated as decorative and dropped from the
    // accessibility tree's "img" role (getByRole('img') would not find
    // it) — query the DOM directly instead.
    const { container } = render(
      <AuthCard title="Sign in" logoUrl="data:image/png;base64,AAA=">
        content
      </AuthCard>,
    )
    expect(container.querySelector('img')).toHaveAttribute('alt', '')
  })

  it('shows the header for logoUrl alone, with no title/subtitle/icon', () => {
    render(<AuthCard logoUrl="data:image/png;base64,AAA=" logoAlt="Acme logo">content</AuthCard>)
    expect(screen.getByRole('img')).toBeInTheDocument()
  })

  it('renders the footer when provided', () => {
    render(
      <AuthCard title="Sign in" footer={<a href="/login">Back to sign in</a>}>
        content
      </AuthCard>,
    )
    expect(screen.getByRole('link', { name: 'Back to sign in' })).toBeInTheDocument()
  })

  it('omits the header entirely when no title, subtitle, or icon is given', () => {
    render(<AuthCard>plain content</AuthCard>)
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('plain content')).toBeInTheDocument()
  })

  it('merges an overriding className onto the card', () => {
    const { container } = render(<AuthCard className="max-w-md">content</AuthCard>)
    const card = container.querySelector('.max-w-md')
    expect(card).not.toBeNull()
    expect(card?.className).not.toContain('max-w-sm')
  })
})
