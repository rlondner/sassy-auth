import * as React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { ShareLinkDialog } from '../share-link-dialog'

jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}))

Object.assign(navigator, {
  clipboard: {
    writeText: jest.fn().mockResolvedValue(undefined),
  },
})

describe('ShareLinkDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.useRealTimers()
  })

  it('renders correctly with given title, description, and url', () => {
    render(
      <ShareLinkDialog
        open={true}
        onOpenChange={() => {}}
        title="Test Share Title"
        description="This is a test description"
        url="https://sassy.example.com/join"
      />
    )

    expect(screen.getByRole('heading', { name: 'Test Share Title' })).toBeInTheDocument()
    expect(screen.getByText('This is a test description')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Test Share Title' })).toHaveValue('https://sassy.example.com/join')
    expect(screen.getByRole('button', { name: 'users.drawer.copyLink' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'users.drawer.done' })).toBeInTheDocument()
  })

  it('automatically selects the entire URL text on click and focus', () => {
    render(
      <ShareLinkDialog
        open={true}
        onOpenChange={() => {}}
        title="Test Share Title"
        description="This is a test description"
        url="https://sassy.example.com/join"
      />
    )

    const input = screen.getByRole('textbox', { name: 'Test Share Title' }) as HTMLInputElement
    const selectSpy = jest.spyOn(input, 'select')

    fireEvent.click(input)
    expect(selectSpy).toHaveBeenCalledTimes(1)

    fireEvent.focus(input)
    expect(selectSpy).toHaveBeenCalledTimes(2)

    selectSpy.mockRestore()
  })

  it('features explicit focus styling classes', () => {
    render(
      <ShareLinkDialog
        open={true}
        onOpenChange={() => {}}
        title="Test Share Title"
        description="This is a test description"
        url="https://sassy.example.com/join"
      />
    )

    const input = screen.getByRole('textbox', { name: 'Test Share Title' })
    expect(input.className).toContain('focus-visible:ring-ring')
    expect(input.className).toContain('focus-visible:outline-none')
    expect(input.className).toContain('focus-visible:ring-2')
    expect(input.className).toContain('focus-visible:ring-offset-2')
  })

  it('copies URL to clipboard and handles feedback timeout', async () => {
    jest.useFakeTimers()

    render(
      <ShareLinkDialog
        open={true}
        onOpenChange={() => {}}
        title="Test Share Title"
        description="This is a test description"
        url="https://sassy.example.com/join"
      />
    )

    const copyBtn = screen.getByRole('button', { name: 'users.drawer.copyLink' })
    fireEvent.click(copyBtn)

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('https://sassy.example.com/join')

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'users.drawer.copied' })).toBeInTheDocument()
    })

    act(() => {
      jest.advanceTimersByTime(2000)
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'users.drawer.copyLink' })).toBeInTheDocument()
    })

    jest.useRealTimers()
  })
})
