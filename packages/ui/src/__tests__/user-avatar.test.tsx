import { render, screen } from '@testing-library/react'
import { UserAvatar } from '../components/user-avatar'

describe('UserAvatar', () => {
  it('renders initials from firstName and lastName', () => {
    render(<UserAvatar firstName="John" lastName="Doe" />)
    expect(screen.getByText('JD')).toBeInTheDocument()
  })

  it('uses single initial when lastName is absent', () => {
    render(<UserAvatar firstName="Alice" lastName="" />)
    expect(screen.getByText('A')).toBeInTheDocument()
  })

  it('renders img when src is provided', () => {
    render(<UserAvatar firstName="John" lastName="Doe" src="https://example.com/avatar.jpg" />)
    expect(screen.getByRole('img')).toHaveAttribute('src', 'https://example.com/avatar.jpg')
  })
})
