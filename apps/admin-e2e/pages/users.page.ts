import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class UsersPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: t('users.title'), exact: true })
    this.createButton = page.getByRole('button', { name: t('users.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/users')
  }

  rowByEmail(email: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(email)) })
  }

  async createUser({
    firstName, lastName, email, orgName,
  }: { firstName: string; lastName: string; email: string; orgName: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('users.fields.firstName')).fill(firstName)
    await this.page.getByLabel(t('users.fields.lastName')).fill(lastName)
    await this.page.getByLabel(t('users.fields.email')).fill(email)
    await this.page.getByLabel(t('users.fields.org')).click()
    await this.page.getByRole('option', { name: orgName }).click()
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('users.toast.created'))
  }

  async editUser(email: string, patch: { firstName?: string; lastName?: string }) {
    await this.rowByEmail(email).getByRole('button', { name: t('common.edit') }).click()
    if (patch.firstName !== undefined) {
      await this.page.getByLabel(t('users.fields.firstName')).fill(patch.firstName)
    }
    if (patch.lastName !== undefined) {
      await this.page.getByLabel(t('users.fields.lastName')).fill(patch.lastName)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('users.toast.updated'))
  }

  async deleteUser(email: string) {
    await this.rowByEmail(email).getByRole('button', { name: t('common.delete') }).click()
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('users.toast.deleted'))
  }

  async resendInvitation(email: string) {
    await this.rowByEmail(email).getByRole('button', { name: t('users.actions.resend') }).click()
    await raceSuccessOrError(this.page, t('users.toast.resent'))
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function raceSuccessOrError(page: Page, successText: string) {
  const success = page.getByText(successText)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)
  const error = page.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([success, error])
  if (outcome === 'error') {
    const text = (await page.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`UI rendered error toast: "${text}"`)
  }
}
