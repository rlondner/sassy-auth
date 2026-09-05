import { render, screen } from '@testing-library/react'
import VerifiedPage from '../page'

jest.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}))

describe('SignupVerifiedPage', () => {
  it('renders a confirmation message and a link to /login', async () => {
    const ui = await VerifiedPage()
    render(ui)
    expect(screen.getByText('signup.verified.title')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'signup.verified.continueToLogin' })).toHaveAttribute('href', '/login')
  })
})
