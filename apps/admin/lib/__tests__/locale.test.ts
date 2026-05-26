import { jest } from '@jest/globals'

// Mock fs and next/headers before importing locale
jest.mock('fs', () => ({
  readdirSync: jest.fn(),
}))
jest.mock('next/headers', () => ({
  cookies: jest.fn(),
  headers: jest.fn(),
}))

import { readdirSync } from 'fs'
import { cookies, headers } from 'next/headers'

const mockReaddirSync = readdirSync as jest.MockedFunction<typeof readdirSync>
const mockCookies = cookies as jest.MockedFunction<typeof cookies>
const mockHeaders = headers as jest.MockedFunction<typeof headers>

// Force module re-import after mock setup
let getAvailableLocales: () => string[]
let getLocale: () => Promise<string>

beforeEach(async () => {
  jest.resetModules()
  const mod = await import('../locale')
  getAvailableLocales = mod.getAvailableLocales
  getLocale = mod.getLocale
})

describe('getAvailableLocales', () => {
  it('returns locale codes from messages directory', () => {
    mockReaddirSync.mockReturnValue(['en.json', 'fr.json'] as unknown as ReturnType<typeof readdirSync>)
    const result = getAvailableLocales()
    expect(result).toEqual(['en', 'fr'])
  })

  it('returns ["en"] if readdirSync throws', () => {
    mockReaddirSync.mockImplementation(() => { throw new Error('ENOENT') })
    const result = getAvailableLocales()
    expect(result).toEqual(['en'])
  })
})

describe('getLocale', () => {
  it('returns locale from NEXT_LOCALE cookie when valid', async () => {
    mockReaddirSync.mockReturnValue(['en.json', 'fr.json'] as unknown as ReturnType<typeof readdirSync>)
    mockCookies.mockResolvedValue({ get: (k: string) => k === 'NEXT_LOCALE' ? { value: 'fr' } : undefined } as unknown as Awaited<ReturnType<typeof cookies>>)
    mockHeaders.mockResolvedValue({ get: () => null } as unknown as Awaited<ReturnType<typeof headers>>)
    expect(await getLocale()).toBe('fr')
  })

  it('falls back to Accept-Language header', async () => {
    mockReaddirSync.mockReturnValue(['en.json', 'fr.json'] as unknown as ReturnType<typeof readdirSync>)
    mockCookies.mockResolvedValue({ get: () => undefined } as unknown as Awaited<ReturnType<typeof cookies>>)
    mockHeaders.mockResolvedValue({ get: (k: string) => k === 'accept-language' ? 'fr-FR,fr;q=0.9,en;q=0.8' : null } as unknown as Awaited<ReturnType<typeof headers>>)
    expect(await getLocale()).toBe('fr')
  })

  it('defaults to en if no match', async () => {
    mockReaddirSync.mockReturnValue(['en.json', 'fr.json'] as unknown as ReturnType<typeof readdirSync>)
    mockCookies.mockResolvedValue({ get: () => undefined } as unknown as Awaited<ReturnType<typeof cookies>>)
    mockHeaders.mockResolvedValue({ get: () => 'de-DE' } as unknown as Awaited<ReturnType<typeof headers>>)
    expect(await getLocale()).toBe('en')
  })
})
