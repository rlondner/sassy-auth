import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class AppsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    this.heading = page.getByRole('heading', { name: new RegExp(`^${escapeRe(t('apps.title'))}\\b`) })
    // The create button label is defined per UI convention via i18n key apps.create.
    this.createButton = page.getByRole('button', { name: t('apps.create') })
    this.accessDenied = page.getByTestId('access-denied-panel')
  }

  async goto() {
    await this.page.goto('/apps')
  }

  rowByName(name: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(name)) })
  }

  async createApp({ name, url }: { name: string; url: string }) {
    await this.createButton.click()
    await this.page.getByLabel(t('apps.fields.name')).fill(name)
    await this.page.getByLabel(t('apps.fields.url')).fill(url)
    await this.page.getByRole('button', { name: t('common.save') }).click()
    // Race: success-toast OR visible error.
    await raceSuccessOrError(this.page, t('apps.toast.created'))
  }

  async editApp(name: string, patch: { name?: string; url?: string }) {
    await this.rowByName(name).getByRole('button', { name: t('common.edit') }).click()
    if (patch.name !== undefined) {
      await this.page.getByLabel(t('apps.fields.name')).fill(patch.name)
    }
    if (patch.url !== undefined) {
      await this.page.getByLabel(t('apps.fields.url')).fill(patch.url)
    }
    await this.page.getByRole('button', { name: t('common.save') }).click()
    await raceSuccessOrError(this.page, t('apps.toast.updated'))
  }

  async deleteApp(name: string) {
    await this.rowByName(name).getByRole('button', { name: t('common.delete') }).click()
    // Confirmation dialog
    await this.page.getByRole('button', { name: t('common.confirm') }).click()
    await raceSuccessOrError(this.page, t('apps.toast.deleted'))
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
