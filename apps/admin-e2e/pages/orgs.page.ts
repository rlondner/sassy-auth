import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class OrgsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('orgs.title'))}\\b`) })
    this.createButton = page.getByRole('button', { name: t('orgs.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/orgs')
  }

  rowByName(name: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(name)) })
  }

  async createOrg({ name, appName }: { name: string; appName: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('orgs.fields.name')).fill(name)
    // App is selected via combobox or select — assumes the form binds to app name.
    await this.page.getByLabel(t('orgs.fields.app')).click()
    await this.page.getByRole('option', { name: appName }).click()
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.created'))
  }

  async editOrg(name: string, patch: { name?: string }) {
    await this.rowByName(name).getByRole('button', { name: t('common.edit') }).click()
    if (patch.name !== undefined) {
      await this.page.getByLabel(t('orgs.fields.name')).fill(patch.name)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.updated'))
  }

  async deleteOrg(name: string) {
    await this.rowByName(name).getByRole('button', { name: t('common.delete') }).click()
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.deleted'))
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
