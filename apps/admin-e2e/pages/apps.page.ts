import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class AppsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    // PageHeader renders the title inside <BreadcrumbPage> (role="link",
    // aria-current="page"), not as a heading element. Match that marker.
    this.heading = page.locator('[aria-current="page"]').filter({ hasText: t('apps.title') })
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
    // Scope to the drawer — the drawer's submit button label collides with
    // the page-level "Create New App" CTA (apps.create === apps.drawer.createTitle).
    const drawer = this.page.getByRole('dialog')
    await drawer.getByLabel(t('apps.fields.name')).fill(name)
    await drawer.getByLabel(t('apps.fields.url')).fill(url)
    await drawer.getByRole('button', { name: t('apps.drawer.createTitle') }).click()
    await raceSuccessOrError(this.page, t('apps.toast.created'))
  }

  async editApp(name: string, patch: { name?: string; url?: string }) {
    // Row actions are inside a DropdownMenu triggered by the "more actions" button.
    await this.rowByName(name).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('apps.actions.edit') }).click()
    const drawer = this.page.getByRole('dialog')
    if (patch.name !== undefined) {
      await drawer.getByLabel(t('apps.fields.name')).fill(patch.name)
    }
    if (patch.url !== undefined) {
      await drawer.getByLabel(t('apps.fields.url')).fill(patch.url)
    }
    await drawer.getByRole('button', { name: t('apps.drawer.save') }).click()
    await raceSuccessOrError(this.page, t('apps.toast.updated'))
  }

  async deleteApp(name: string) {
    await this.rowByName(name).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('apps.actions.delete') }).click()
    await this.page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('apps.confirmDelete.button') })
      .click()
    await raceSuccessOrError(this.page, t('apps.toast.deleted'))
  }
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function raceSuccessOrError(page: Page, successText: string) {
  // Scope error detection to sonner's toast container + any open dialog/
  // alertdialog. Next.js Dev Tools mounts a persistent empty role="alert"
  // placeholder at the page root — a global page.getByRole('alert') would
  // match it on every poll and the error race would always win.
  const errorScope = page.locator(
    '[data-sonner-toaster], [role="dialog"], [role="alertdialog"]',
  )
  const success = page.getByText(successText)
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'success' as const)
    .catch(() => null)
  const error = errorScope.getByRole('alert')
    .waitFor({ state: 'visible', timeout: 10_000 })
    .then(() => 'error' as const)
    .catch(() => null)
  const outcome = await Promise.race([success, error])
  if (outcome === 'error') {
    const text = (await errorScope.getByRole('alert').textContent())?.trim() ?? '<unknown>'
    throw new Error(`UI rendered error toast: "${text}"`)
  }
}
