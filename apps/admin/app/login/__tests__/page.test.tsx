import { generateMetadata } from '../page'
import { fetchSocialProviders } from '@/lib/social-providers'

jest.mock('@/lib/social-providers', () => ({
  fetchSocialProviders: jest.fn(),
}))

const mockFetchSocialProviders = fetchSocialProviders as jest.MockedFunction<typeof fetchSocialProviders>

// validateNextUrl only accepts a same-origin path or an absolute URL whose
// origin matches AUTH_SERVER_URL (default https://localhost:3010 — see
// apps/admin/lib/safe-next.ts's allowlist()), so this uses that default
// origin rather than a real resource server's domain — the shape mirrors
// the authorize-URL `next` a resource-server app actually sends (e.g.
// `https://auth-api-dev.milissai.com/api/token/oauth/authorize?client_id=...`),
// just on an origin this test environment's default allowlist accepts.
const AUTHORIZE_NEXT = 'https://localhost:3010/api/token/oauth/authorize?client_id=p5sV&redirect_uri=https%3A%2F%2Flocalhost%3A3030%2Fapi%2Fauth%2Fcallback&scope=openid+email+profile'

beforeEach(() => {
  jest.clearAllMocks()
})

describe('LoginPage generateMetadata', () => {
  it('sets the title to "{appName} Sign In" when next resolves to a named app', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: 'Acme', favicon: null, pageLightBackgroundColor: null, pageDarkBackgroundColor: null, cardLightBackgroundColor: null, cardDarkBackgroundColor: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.title).toBe('Acme Sign In')
  })

  it('leaves the title unset when there is no next', async () => {
    const metadata = await generateMetadata({ searchParams: Promise.resolve({}) })
    expect(metadata.title).toBeUndefined()
    expect(mockFetchSocialProviders).not.toHaveBeenCalled()
  })

  it('leaves the title unset when next does not resolve to a named app', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: null, favicon: null, pageLightBackgroundColor: null, pageDarkBackgroundColor: null, cardLightBackgroundColor: null, cardDarkBackgroundColor: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.title).toBeUndefined()
  })

  it('sets the tab icon when the resolved app has a favicon', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: 'Acme', favicon: 'data:image/png;base64,FFF=' , pageLightBackgroundColor: null, pageDarkBackgroundColor: null, cardLightBackgroundColor: null, cardDarkBackgroundColor: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.icons).toEqual({ icon: 'data:image/png;base64,FFF=' })
  })

  it('leaves the icon unset when the resolved app has no favicon', async () => {
    mockFetchSocialProviders.mockResolvedValue({ providers: [], logo: null, name: 'Acme', favicon: null, pageLightBackgroundColor: null, pageDarkBackgroundColor: null, cardLightBackgroundColor: null, cardDarkBackgroundColor: null })
    const metadata = await generateMetadata({ searchParams: Promise.resolve({ next: AUTHORIZE_NEXT }) })
    expect(metadata.icons).toBeUndefined()
  })
})
