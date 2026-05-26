import { readdirSync } from 'fs'
import { join } from 'path'
import { cookies, headers } from 'next/headers'

let _locales: string[] | null = null

export function getAvailableLocales(): string[] {
  if (_locales) return _locales
  try {
    _locales = readdirSync(join(process.cwd(), 'messages'))
      .filter((f) => typeof f === 'string' && f.endsWith('.json'))
      .map((f) => (f as string).replace('.json', ''))
  } catch {
    _locales = ['en']
  }
  return _locales
}

export async function getLocale(): Promise<string> {
  const cookieStore = await cookies()
  const fromCookie = cookieStore.get('NEXT_LOCALE')?.value
  const available = getAvailableLocales()
  if (fromCookie && available.includes(fromCookie)) return fromCookie

  const headersList = await headers()
  const acceptLang = headersList.get('accept-language') ?? ''
  const preferred = acceptLang
    .split(',')
    .map((l) => l.split(';')[0].trim().split('-')[0])
    .find((l) => available.includes(l))

  return preferred ?? 'en'
}
