import { render, screen } from '@testing-library/react'
import { AuthDivider } from '../components/auth-divider'

describe('AuthDivider', () => {
  it('renders the given label', () => {
    render(<AuthDivider label="or continue with" />)
    expect(screen.getByText('or continue with')).toBeInTheDocument()
  })

  it('renders two separators flanking the label', () => {
    // Radix's Separator renders role="none" (not role="separator") when its
    // `decorative` prop is true, which is the default both here and in the
    // Separator wrapper this divider uses — see
    // packages/ui/src/components/ui/separator.tsx and
    // node_modules/@radix-ui/react-separator's `semanticProps` branch. Query
    // by `data-orientation`, which Radix always sets regardless of
    // `decorative`, instead of `[role="separator"]`.
    const { container } = render(<AuthDivider label="or continue with" />)
    expect(container.querySelectorAll('[data-orientation="horizontal"]')).toHaveLength(2)
  })
})
