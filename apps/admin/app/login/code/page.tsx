import { validateNextUrl } from '@/lib/safe-next'
import { LoginOtpForm } from '../login-otp-form'

export const dynamic = 'force-dynamic'

export default async function LoginCodePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const params = await searchParams
  const nextSafe = validateNextUrl(params.next)
  return <LoginOtpForm next={nextSafe ?? ''} />
}
