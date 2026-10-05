'use client'

import * as React from 'react'
import { useTranslations } from 'next-intl'
import { AuthCard } from '@sassy-auth/ui'
import type { PasswordPolicy } from '@/lib/types'
import { SignupWizard, type Step } from './signup-wizard'

interface SignupWizardCardProps {
  clientId: string
  next: string
  hasDefaultOrg: boolean
  passwordPolicy: PasswordPolicy | null
  privacyPolicyUrl: string | null
  termsUrl: string | null
  gdprUrl: string | null
  appName: string | null
  logo: string | null
  pageLightBackgroundColor: string | null
  pageDarkBackgroundColor: string | null
  cardLightBackgroundColor: string | null
  cardDarkBackgroundColor: string | null
  footer: React.ReactNode
}

export function SignupWizardCard({
  clientId,
  next,
  hasDefaultOrg,
  passwordPolicy,
  privacyPolicyUrl,
  termsUrl,
  gdprUrl,
  appName,
  logo,
  pageLightBackgroundColor,
  pageDarkBackgroundColor,
  cardLightBackgroundColor,
  cardDarkBackgroundColor,
  footer,
}: SignupWizardCardProps) {
  const t = useTranslations('signup')
  const [step, setStep] = React.useState<Step>('email')

  const title = step === 'code' ? t('verifyCode.title') : appName ? t('titleWithApp', { appName }) : t('title')
  const subtitle =
    step === 'code' ? t('verifyCode.headerSubtitle') : hasDefaultOrg ? t('subtitleDefaultOrg') : t('subtitle')

  return (
    <AuthCard
      title={title}
      subtitle={subtitle}
      logoUrl={logo}
      logoAlt={appName ?? t('title')}
      footer={footer}
      pageLightBackgroundColor={pageLightBackgroundColor}
      pageDarkBackgroundColor={pageDarkBackgroundColor}
      cardLightBackgroundColor={cardLightBackgroundColor}
      cardDarkBackgroundColor={cardDarkBackgroundColor}
    >
      <SignupWizard
        clientId={clientId}
        next={next}
        hasDefaultOrg={hasDefaultOrg}
        passwordPolicy={passwordPolicy}
        privacyPolicyUrl={privacyPolicyUrl}
        termsUrl={termsUrl}
        gdprUrl={gdprUrl}
        onStepChange={setStep}
      />
    </AuthCard>
  )
}
