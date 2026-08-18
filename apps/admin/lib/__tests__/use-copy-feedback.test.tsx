import { renderHook, act } from '@testing-library/react'
import { toast } from 'sonner'
import { useCopyFeedback } from '../use-copy-feedback'
import { copyToClipboard } from '../clipboard'

jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }))
jest.mock('../clipboard', () => ({ copyToClipboard: jest.fn() }))

// next-intl's useTranslations echoes the key back, so an un-translated literal
// is immediately visible in the assertion.
jest.mock('next-intl', () => ({
  useTranslations: () => (key: string) => `t:${key}`,
}))

const mockCopy = copyToClipboard as jest.Mock
const mockToastError = toast.error as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('useCopyFeedback', () => {
  it('reports success and sets the copied key', async () => {
    mockCopy.mockResolvedValue(true)
    const { result } = renderHook(() => useCopyFeedback())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.copy('secret', 'row-1')
    })

    expect(ok).toBe(true)
    expect(result.current.copiedKey).toBe('row-1')
    expect(mockToastError).not.toHaveBeenCalled()
  })

  // bug-0227: the failure toast was the literal string
  // 'Failed to copy — clipboard access denied', the only user-facing string in
  // the admin app bypassing next-intl. French users saw English.
  it('localizes the clipboard-failure toast', async () => {
    mockCopy.mockResolvedValue(false)
    const { result } = renderHook(() => useCopyFeedback())

    await act(async () => {
      await result.current.copy('secret', 'row-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('t:common.copyFailed')
  })

  it('reports failure and leaves the copied key unset', async () => {
    mockCopy.mockResolvedValue(false)
    const { result } = renderHook(() => useCopyFeedback())

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.copy('secret', 'row-1')
    })

    expect(ok).toBe(false)
    expect(result.current.copiedKey).toBeNull()
  })

  it('prefers an explicitly supplied message over the default key', async () => {
    mockCopy.mockResolvedValue(false)
    const { result } = renderHook(() => useCopyFeedback({ errorMessage: 'Nope.' }))

    await act(async () => {
      await result.current.copy('secret', 'row-1')
    })

    expect(mockToastError).toHaveBeenCalledWith('Nope.')
  })

  it('still accepts the legacy positional resetMs argument', async () => {
    // 14 call sites use the hook; several pass a custom reset delay
    // positionally. Changing the signature must not break them.
    jest.useFakeTimers()
    mockCopy.mockResolvedValue(true)
    const { result } = renderHook(() => useCopyFeedback(50))

    await act(async () => {
      await result.current.copy('secret', 'row-1')
    })
    expect(result.current.copiedKey).toBe('row-1')

    act(() => {
      jest.advanceTimersByTime(51)
    })
    expect(result.current.copiedKey).toBeNull()
    jest.useRealTimers()
  })
})
