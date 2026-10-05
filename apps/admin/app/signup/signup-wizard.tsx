'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, FormField, OtpInput } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { FALLBACK_PASSWORD_POLICY, type PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { PasswordStrengthMeter } from '@/components/password-strength-meter'
import { Turnstile } from '@marsidev/react-turnstile'
import { obfuscateEmail } from '@/lib/obfuscate-email'
import { startRegistrationAction, verifyRegistrationCodeAction, completeRegistrationAction } from './wizard-actions'

export type Step = 'email' | 'code' | 'password' | 'name'

interface SignupWizardProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
  onStepChange?: (step: Step) => void
}

const VERIFY_CODE_ERROR_KEY: Record<string, string> = {
  INVALID_OTP: 'verifyCode.errorInvalid',
  OTP_EXPIRED: 'verifyCode.errorExpired',
  TOO_MANY_ATTEMPTS: 'verifyCode.errorTooManyAttempts',
}

const RESEND_COOLDOWN_SECONDS = 30
type ResendStatus = 'idle' | 'sending' | 'sent' | 'error'

export function SignupWizard({
  clientId,
  next,
  hasDefaultOrg,
  passwordPolicy,
  privacyPolicyUrl,
  termsUrl,
  gdprUrl,
  onStepChange,
}: SignupWizardProps) {
  const t = useTranslations('signup')
  const tCommon = useTranslations('common')
  const router = useRouter()
  const [step, setStep] = React.useState<Step>('email')

  React.useEffect(() => {
    onStepChange?.(step)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])
  const [email, setEmail] = React.useState('')
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)
  const [otp, setOtp] = React.useState('')
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [companyName, setCompanyName] = React.useState('')
  const [marketingOptIn, setMarketingOptIn] = React.useState(false)
  const [acceptedPrivacyPolicy, setAcceptedPrivacyPolicy] = React.useState(false)
  const [acceptedTerms, setAcceptedTerms] = React.useState(false)
  const [acceptedGdpr, setAcceptedGdpr] = React.useState(false)
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [resendStatus, setResendStatus] = React.useState<ResendStatus>('idle')
  const [resendCooldown, setResendCooldown] = React.useState(0)

  React.useEffect(() => {
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      console.warn('NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set; the signup captcha widget will not function.')
    }
  }, [])

  React.useEffect(() => {
    if (resendCooldown === 0) return
    const id = setInterval(() => setResendCooldown((s) => Math.max(0, s - 1)), 1000)
    return () => clearInterval(id)
  }, [resendCooldown])

  const policy = passwordPolicy ?? FALLBACK_PASSWORD_POLICY
  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)
  const passwordsMismatch = confirm.length > 0 && password !== confirm
  const consentSatisfied =
    (!privacyPolicyUrl || acceptedPrivacyPolicy) &&
    (!termsUrl || acceptedTerms) &&
    (!gdprUrl || acceptedGdpr)

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!captchaToken) {
      setError(t('errors.captchaRequired'))
      return
    }
    setError(null)
    setSubmitting(true)
    try {
      const result = await startRegistrationAction({ clientId, email, turnstileToken: captchaToken })
      if ('error' in result) {
        setError(t(`errors.${result.error}`))
        return
      }
      setStep('code')
    } catch {
      setError(t('errors.validationError'))
    } finally {
      setSubmitting(false)
    }
  }

  async function verifyCode(code: string) {
    setError(null)
    setSubmitting(true)
    try {
      const result = await verifyRegistrationCodeAction({ email, otp: code })
      if ('error' in result) {
        setError(t(VERIFY_CODE_ERROR_KEY[result.error] ?? 'verifyCode.errorGeneric'))
        return
      }
      setStep('password')
    } catch {
      setError(t('errors.validationError'))
    } finally {
      setSubmitting(false)
    }
  }

  // Auto-verify as soon as all 6 digits are entered — no separate submit
  // button on this step. Re-fires whenever `otp` changes back to a full
  // 6-digit value (e.g. after correcting a wrong code), but not on every
  // render, since it's only a dependency-change effect.
  React.useEffect(() => {
    if (step !== 'code' || otp.length !== 6) return
    void verifyCode(otp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, otp])

  async function handleResend() {
    if (resendCooldown > 0 || resendStatus === 'sending') return
    // Same constraint as the OTP_EXPIRED resend in handleNameSubmit below:
    // /register/start requires a Turnstile token, but the only one we have
    // is the single-use/short-lived token captured on the email step, which
    // was already consumed by that step's own startRegistrationAction call.
    // Reusing it here will very plausibly fail with captchaFailed. Try it
    // anyway (it can still succeed if the token hasn't expired/been
    // consumed), but don't strand the user on a dead end if it doesn't —
    // bounce back to the email step to re-verify, same as the expired-code
    // path does.
    if (!captchaToken) {
      setOtp('')
      setStep('email')
      setError(t('errors.captchaRequired'))
      return
    }
    setResendStatus('sending')
    try {
      const result = await startRegistrationAction({ clientId, email, turnstileToken: captchaToken })
      if ('error' in result) {
        setCaptchaToken(null)
        setOtp('')
        setStep('email')
        setError(t('errors.captchaRequired'))
        setResendStatus('idle')
        return
      }
      setOtp('')
      setResendStatus('sent')
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      setResendStatus('error')
    }
  }

  function handlePasswordSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (passwordsMismatch) {
      setError(t('errors.passwordMismatch'))
      return
    }
    if (!policyMet) {
      setError(t('errors.passwordComplexity'))
      return
    }
    setError(null)
    setStep('name')
  }

  async function handleNameSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!consentSatisfied) return
    setError(null)
    setSubmitting(true)
    try {
      const result = await completeRegistrationAction({
        clientId,
        email,
        otp,
        password,
        firstName,
        lastName,
        ...(hasDefaultOrg ? {} : { companyName }),
        ...(privacyPolicyUrl ? { acceptedPrivacyPolicy } : {}),
        ...(termsUrl ? { acceptedTerms } : {}),
        ...(gdprUrl ? { acceptedGdpr } : {}),
        marketingOptIn,
        ...(next ? { next } : {}),
      })
      if ('error' in result) {
        if (result.error === 'OTP_EXPIRED') {
          // The code expired while filling in password/name. Try to resend a
          // fresh one, reusing the already-captured captcha token. Turnstile
          // tokens are single-use/short-lived, though — the SAME token was
          // already consumed by the original startRegistrationAction call on
          // the email step, so this resend will very plausibly fail with
          // captchaFailed. Don't assume success: if the resend itself errors,
          // no new code was actually sent, so bounce the user back to the
          // email step to re-verify (email stays filled in, nothing is
          // lost) rather than stranding them on the code step waiting for an
          // email that will never arrive. Only on a successful resend do we
          // go to the code step — password/name stay in this component's
          // state either way, so nothing typed is lost.
          if (captchaToken) {
            const resendResult = await startRegistrationAction({ clientId, email, turnstileToken: captchaToken })
            if ('error' in resendResult) {
              setCaptchaToken(null)
              setOtp('')
              setError(t('errors.captchaRequired'))
              setStep('email')
              return
            }
          }
          setOtp('')
          setError(t('verifyCode.errorExpired'))
          setStep('code')
          return
        }
        setError(t(`errors.${result.error}`))
        return
      }
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl
        return
      }
      router.push('/signup/verified')
    } catch {
      setError(t('errors.validationError'))
    } finally {
      setSubmitting(false)
    }
  }

  if (step === 'email') {
    return (
      <form onSubmit={handleEmailSubmit} className="flex flex-col gap-4">
        <FormField
          id="email"
          type="email"
          autoComplete="email"
          label={t('email')}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Turnstile
          siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
          onSuccess={setCaptchaToken}
          onExpire={() => setCaptchaToken(null)}
        />
        {error && (
          <p data-testid="signup-error" className="text-label-md text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" loading={submitting} disabled={submitting || email.length === 0}>
          {t('continue')}
        </Button>
      </form>
    )
  }

  if (step === 'code') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-body-md text-muted-foreground">{t('verifyCode.subtitle', { email: obfuscateEmail(email) })}</p>
        <OtpInput
          id="otp"
          data-testid="otp"
          label={t('verifyCode.codeLabel')}
          value={otp}
          onChange={setOtp}
          autoFocus
          disabled={submitting}
          digitAriaLabel={(position, total) => t('verifyCode.digitAriaLabel', { position: String(position), total: String(total) })}
        />
        <p className="text-body-sm text-muted-foreground">
          {t('verifyCode.didntReceiveIt')}{' '}
          {resendCooldown > 0 ? (
            t('verifyCode.resendCooldown', { seconds: String(resendCooldown) })
          ) : (
            <button
              type="button"
              onClick={handleResend}
              disabled={resendStatus === 'sending'}
              className="text-primary hover:underline disabled:opacity-50"
            >
              {t('verifyCode.resendButton')}
            </button>
          )}
        </p>
        {resendStatus === 'sent' && (
          <p data-testid="resend-sent" className="text-body-sm text-muted-foreground">
            {t('verifyCode.resendSent')}
          </p>
        )}
        {resendStatus === 'error' && (
          <p data-testid="resend-error" className="text-label-md text-destructive">
            {t('verifyCode.resendError')}
          </p>
        )}
        {error && (
          <p data-testid="signup-error" className="text-label-md text-destructive">
            {error}
          </p>
        )}
        {submitting && (
          <p data-testid="verify-pending" className="text-body-sm text-muted-foreground">
            {t('verifyCode.verifying')}
          </p>
        )}
      </div>
    )
  }

  if (step === 'password') {
    return (
      <form onSubmit={handlePasswordSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <FormField
            id="password"
            type="password"
            label={t('password')}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            showPasswordLabel={tCommon('showPassword')}
            hidePasswordLabel={tCommon('hidePassword')}
            required
          />
          <PasswordStrengthMeter password={password} policy={policy} />
          <PasswordRequirementsChecklist password={password} policy={policy} />
        </div>
        <FormField
          id="confirm-password"
          label={t('confirmPassword')}
          type="password"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={passwordsMismatch ? t('errors.passwordMismatch') : undefined}
          showPasswordLabel={tCommon('showPassword')}
          hidePasswordLabel={tCommon('hidePassword')}
          required
        />
        {error && (
          <p data-testid="signup-error" className="text-label-md text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" className="w-full" disabled={!policyMet || password !== confirm || password.length === 0}>
          {t('continue')}
        </Button>
      </form>
    )
  }

  return (
    <form onSubmit={handleNameSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField id="firstName" label={t('firstName')} value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
        <FormField id="lastName" label={t('lastName')} value={lastName} onChange={(e) => setLastName(e.target.value)} required />
      </div>
      {!hasDefaultOrg && (
        <FormField id="companyName" label={t('companyName')} value={companyName} onChange={(e) => setCompanyName(e.target.value)} required />
      )}
      <label className="flex items-start gap-2 text-body-sm text-foreground">
        <input type="checkbox" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />
        <span>{t('marketingOptIn')}</span>
      </label>
      {privacyPolicyUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input type="checkbox" checked={acceptedPrivacyPolicy} onChange={(e) => setAcceptedPrivacyPolicy(e.target.checked)} required />
          <span>
            {t.rich('acceptPrivacyPolicy', {
              link: (chunks) => (
                <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {termsUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input type="checkbox" checked={acceptedTerms} onChange={(e) => setAcceptedTerms(e.target.checked)} required />
          <span>
            {t.rich('acceptTerms', {
              link: (chunks) => (
                <a href={termsUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {gdprUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input type="checkbox" checked={acceptedGdpr} onChange={(e) => setAcceptedGdpr(e.target.checked)} required />
          <span>
            {t.rich('acceptGdpr', {
              link: (chunks) => (
                <a href={gdprUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {error && (
        <p data-testid="signup-error" className="text-label-md text-destructive">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={
          submitting ||
          !consentSatisfied ||
          (!hasDefaultOrg && companyName.trim() === '') ||
          firstName.trim() === '' ||
          lastName.trim() === ''
        }
      >
        {t('submit')}
      </Button>
    </form>
  )
}
