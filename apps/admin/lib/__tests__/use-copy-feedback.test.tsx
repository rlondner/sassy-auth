import * as React from 'react'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import { useCopyFeedback } from '../use-copy-feedback'
import { copyToClipboard } from '../clipboard'
import { toast } from 'sonner'

// Mock dependencies
jest.mock('../clipboard', () => ({
  copyToClipboard: jest.fn(),
}))

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}))

function withIntl(node: React.ReactNode) {
  return (
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )
}

// Test component that uses the hook
function TestComponent() {
  const { copiedKey, copy } = useCopyFeedback(50) // use 50ms for extremely fast real-timer testing
  return (
    <div>
      <span data-testid="copied-key">{copiedKey || 'none'}</span>
      <button onClick={() => copy('test-text', 'test-key')}>Copy Key</button>
    </div>
  )
}

describe('useCopyFeedback', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('sets copied key on successful copy and resets after timeout', async () => {
    ;(copyToClipboard as jest.Mock).mockResolvedValue(true)

    render(withIntl(<TestComponent />))

    expect(screen.getByTestId('copied-key')).toHaveTextContent('none')

    const button = screen.getByRole('button', { name: 'Copy Key' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalledWith('test-text')
    })

    await waitFor(() => {
      expect(screen.getByTestId('copied-key')).toHaveTextContent('test-key')
    })

    // Wait for the 50ms timeout to clear the key
    await waitFor(() => {
      expect(screen.getByTestId('copied-key')).toHaveTextContent('none')
    }, { timeout: 300 })
  })

  it('triggers error toast on failed copy', async () => {
    ;(copyToClipboard as jest.Mock).mockResolvedValue(false)

    render(withIntl(<TestComponent />))

    const button = screen.getByRole('button', { name: 'Copy Key' })
    fireEvent.click(button)

    await waitFor(() => {
      expect(copyToClipboard).toHaveBeenCalled()
    })

    await waitFor(() => {
      expect(toast.error).toHaveBeenCalledWith(en.common.copyError)
    })

    expect(screen.getByTestId('copied-key')).toHaveTextContent('none')
  })
})
