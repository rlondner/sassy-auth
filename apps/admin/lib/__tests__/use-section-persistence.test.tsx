import { renderHook, act } from '@testing-library/react'
import { useSectionPersistence } from '../use-section-persistence'

beforeEach(() => {
  window.localStorage.clear()
})

describe('useSectionPersistence', () => {
  it('falls back to true for a section with no stored value and no override default', () => {
    const { result } = renderHook(() => useSectionPersistence('view', {}))
    expect(result.current.isOpen('branding')).toBe(true)
  })

  it('falls back to the supplied default when nothing is stored', () => {
    const { result } = renderHook(() => useSectionPersistence('edit', { branding: false }))
    expect(result.current.isOpen('branding')).toBe(false)
    expect(result.current.isOpen('general')).toBe(true)
  })

  it('setOpen updates isOpen immediately and persists to localStorage', () => {
    const { result } = renderHook(() => useSectionPersistence('edit', { branding: false }))
    act(() => {
      result.current.setOpen('branding', true)
    })
    expect(result.current.isOpen('branding')).toBe(true)
    expect(JSON.parse(window.localStorage.getItem('sa-app-drawer-sections:edit') ?? '{}')).toEqual({
      branding: true,
    })
  })

  it('a stored value overrides the supplied default on next mount', () => {
    window.localStorage.setItem('sa-app-drawer-sections:edit', JSON.stringify({ branding: true }))
    const { result } = renderHook(() => useSectionPersistence('edit', { branding: false }))
    expect(result.current.isOpen('branding')).toBe(true)
  })

  it('does not throw when localStorage.setItem fails', () => {
    const spy = jest.spyOn(window.localStorage.__proto__, 'setItem').mockImplementation(() => {
      throw new Error('quota exceeded')
    })
    const { result } = renderHook(() => useSectionPersistence('edit', {}))
    expect(() => {
      act(() => {
        result.current.setOpen('branding', true)
      })
    }).not.toThrow()
    expect(result.current.isOpen('branding')).toBe(true)
    spy.mockRestore()
  })

  it('keeps create/edit/view maps independent', () => {
    const editHook = renderHook(() => useSectionPersistence('edit', {}))
    act(() => {
      editHook.result.current.setOpen('branding', false)
    })
    const createHook = renderHook(() => useSectionPersistence('create', {}))
    expect(createHook.result.current.isOpen('branding')).toBe(true)
  })
})
