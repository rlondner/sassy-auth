import { validateNextUrl } from '@/lib/safe-next'
import { TwoFactorForm } from './TwoFactorForm'

export const dynamic = 'force-dynamic'

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  return <TwoFactorForm next={nextSafe ?? ''} />
}
