'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { Button, FormField } from '@sassy-auth/ui'
import { evaluatePasswordPolicy } from '@sassy-auth/types'
import { FALLBACK_PASSWORD_POLICY, type PasswordPolicy } from '@/lib/types'
import { PasswordRequirementsChecklist } from '@/components/password-requirements-checklist'
import { Turnstile } from '@marsidev/react-turnstile'
import { registerAction } from './actions'

interface SignupFormProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
}

const KNOWN_ERRORS = [
  'appNotFound',
  'emailTaken',
  'captchaFailed',
  'tooManyRequests',
  'serverUnavailable',
  'validationError',
] as const

export function SignupForm({ clientId, next, hasDefaultOrg, passwordPolicy, privacyPolicyUrl, termsUrl, gdprUrl }: SignupFormProps) {
  const t = useTranslations()
  const router = useRouter()
  const [firstName, setFirstName] = React.useState('')
  const [lastName, setLastName] = React.useState('')
  const [companyName, setCompanyName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [emailError, setEmailError] = React.useState<string | null>(null)
  const emailRef = React.useRef<HTMLInputElement>(null)
  const [password, setPassword] = React.useState('')
  const [confirm, setConfirm] = React.useState('')
  const [error, setError] = React.useState<string | null>(null)
  const [submitting, setSubmitting] = React.useState(false)
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null)
  const [acceptedPrivacyPolicy, setAcceptedPrivacyPolicy] = React.useState(false)
  const [acceptedTerms, setAcceptedTerms] = React.useState(false)
  const [acceptedGdpr, setAcceptedGdpr] = React.useState(false)

  React.useEffect(() => {
    if (!process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) {
      console.warn('NEXT_PUBLIC_TURNSTILE_SITE_KEY is not set; the signup captcha widget will not function.')
    }
  }, [])

  const policy = passwordPolicy ?? FALLBACK_PASSWORD_POLICY
  const policyMet = evaluatePasswordPolicy(password, policy).every((r) => r.met)
  const passwordsMismatch = confirm.length > 0 && password !== confirm
  const consentSatisfied =
    (!privacyPolicyUrl || acceptedPrivacyPolicy) &&
    (!termsUrl || acceptedTerms) &&
    (!gdprUrl || acceptedGdpr)

  function validateEmail() {
    // bug-0295: `validity.valid` is also false for an empty *required*
    // field (ValidityState.valueMissing), not just a malformed one. Left
    // unguarded, blurring the email field before typing anything — e.g.
    // tabbing through the form — showed "Please enter a valid email
    // address" on an untouched field. Only the format check belongs here;
    // "required" is enforced separately (native constraint validation on
    // submit, and the disabled-submit-button checks below).
    if (emailRef.current?.value.length === 0) {
      setEmailError(null)
      return true
    }
    const valid = emailRef.current?.validity.valid ?? true
    setEmailError(valid ? null : t('signup.errors.invalidEmail'))
    return valid
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!validateEmail()) return
    if (passwordsMismatch) { setError(t('signup.errors.passwordMismatch')); return }
    if (!policyMet) { setError(t('signup.errors.passwordComplexity')); return }
    if (!captchaToken) { setError(t('signup.errors.captchaRequired')); return }
    setError(null)
    setSubmitting(true)
    try {
      const result = await registerAction({
        clientId, firstName, lastName, email, password, turnstileToken: captchaToken,
        ...(hasDefaultOrg ? {} : { companyName }),
        ...(privacyPolicyUrl ? { acceptedPrivacyPolicy } : {}),
        ...(termsUrl ? { acceptedTerms } : {}),
        ...(gdprUrl ? { acceptedGdpr } : {}),
        ...(next ? { next } : {}),
      })
      if ('error' in result) {
        const key = (KNOWN_ERRORS as readonly string[]).includes(result.error) ? result.error : 'validationError'
        setError(t(`signup.errors.${key as (typeof KNOWN_ERRORS)[number]}`))
        return
      }
      if (result.redirectUrl) {
        window.location.href = result.redirectUrl
        return
      }
      router.push(
        `/signup/check-email?email=${encodeURIComponent(email)}&clientId=${encodeURIComponent(clientId)}${next ? `&next=${encodeURIComponent(next)}` : ''}`,
      )
    } catch {
      setError(t('signup.errors.validationError'))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4">
        <FormField
          id="firstName"
          label={t('signup.firstName')}
          value={firstName}
          onChange={(e) => setFirstName(e.target.value)}
          required
        />
        <FormField
          id="lastName"
          label={t('signup.lastName')}
          value={lastName}
          onChange={(e) => setLastName(e.target.value)}
          required
        />
      </div>
      {!hasDefaultOrg && (
        <FormField
          id="companyName"
          label={t('signup.companyName')}
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          required
        />
      )}
      <FormField
        ref={emailRef}
        id="email"
        type="email"
        autoComplete="email"
        label={t('signup.email')}
        value={email}
        onChange={(e) => {
          setEmail(e.target.value)
          if (emailError) setEmailError(null)
        }}
        onBlur={validateEmail}
        error={emailError ?? undefined}
        required
      />
      <div className="flex flex-col gap-1.5">
        <FormField
          id="password"
          type="password"
          label={t('signup.password')}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          showPasswordLabel={t('common.showPassword')}
          hidePasswordLabel={t('common.hidePassword')}
          required
        />
        <PasswordRequirementsChecklist password={password} policy={policy} />
      </div>
      <FormField
        id="confirm-password"
        type="password"
        label={t('signup.confirmPassword')}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        error={passwordsMismatch ? t('signup.errors.passwordMismatch') : undefined}
        showPasswordLabel={t('common.showPassword')}
        hidePasswordLabel={t('common.hidePassword')}
        required
      />
      <Turnstile
        siteKey={process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? ''}
        onSuccess={setCaptchaToken}
        onExpire={() => setCaptchaToken(null)}
      />
      {privacyPolicyUrl && (
        <label className="flex items-start gap-2 text-body-sm text-foreground">
          <input
            type="checkbox"
            checked={acceptedPrivacyPolicy}
            onChange={(e) => setAcceptedPrivacyPolicy(e.target.checked)}
            required
          />
          <span>
            {t.rich('signup.acceptPrivacyPolicy', {
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
          <input
            type="checkbox"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            required
          />
          <span>
            {t.rich('signup.acceptTerms', {
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
          <input
            type="checkbox"
            checked={acceptedGdpr}
            onChange={(e) => setAcceptedGdpr(e.target.checked)}
            required
          />
          <span>
            {t.rich('signup.acceptGdpr', {
              link: (chunks) => (
                <a href={gdprUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {chunks}
                </a>
              ),
            })}
          </span>
        </label>
      )}
      {error && <p data-testid="signup-error" className="text-label-md text-destructive">{error}</p>}
      <Button
        type="submit"
        className="w-full"
        loading={submitting}
        disabled={submitting || !!emailError || !policyMet || password !== confirm || password.length === 0 || !consentSatisfied}
      >
        {t('signup.submit')}
      </Button>
    </form>
  )
}
