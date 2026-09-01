import { copyToClipboard } from '../clipboard'

describe('copyToClipboard', () => {
  const originalClipboard = navigator.clipboard

  afterEach(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: originalClipboard,
      configurable: true,
    })
  })

  it('writes the text and returns true on success', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    const result = await copyToClipboard('secret')

    expect(result).toBe(true)
    expect(writeText).toHaveBeenCalledWith('secret')
  })

  it('invokes the onCopied callback on success', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      configurable: true,
    })
    const onCopied = jest.fn()

    await copyToClipboard('secret', onCopied)

    expect(onCopied).toHaveBeenCalledTimes(1)
  })

  it('returns false and does not throw when the clipboard API rejects', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockRejectedValue(new Error('denied')) },
      configurable: true,
    })
    const onCopied = jest.fn()

    const result = await copyToClipboard('secret', onCopied)

    expect(result).toBe(false)
    expect(onCopied).not.toHaveBeenCalled()
  })
})
