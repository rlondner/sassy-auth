import { validateNextUrl } from '@/lib/safe-next'
import { TwoFactorPromptClient } from './TwoFactorPromptClient'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPromptPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  return <TwoFactorPromptClient next={nextSafe ?? ''} />
}
