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
