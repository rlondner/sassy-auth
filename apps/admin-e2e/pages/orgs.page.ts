import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class OrgsPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    // PageHeader renders the title inside <BreadcrumbPage> (role="link",
    // aria-current="page"), not as a heading element. Match that marker.
    this.heading = page.locator('[aria-current="page"]').filter({ hasText: t('orgs.title') })
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
    const drawer = this.page.getByRole('dialog')
    await drawer.getByLabel(t('orgs.fields.name')).fill(name)
    // App is selected via combobox or select — assumes the form binds to app name.
    await drawer.getByLabel(t('orgs.fields.app')).click()
    await this.page.getByRole('option', { name: appName }).click()
    await drawer.getByRole('button', { name: t('orgs.drawer.createTitle') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.created'))
  }

  async editOrg(name: string, patch: { name?: string }) {
    // Row actions are inside a DropdownMenu triggered by the "more actions" button.
    await this.rowByName(name).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('orgs.actions.edit') }).click()
    const drawer = this.page.getByRole('dialog')
    if (patch.name !== undefined) {
      await drawer.getByLabel(t('orgs.fields.name')).fill(patch.name)
    }
    await drawer.getByRole('button', { name: t('orgs.drawer.save') }).click()
    await raceSuccessOrError(this.page, t('orgs.toast.updated'))
  }

  async deleteOrg(name: string) {
    await this.rowByName(name).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('orgs.actions.delete') }).click()
    await this.page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('orgs.confirmDelete.button') })
      .click()
    await raceSuccessOrError(this.page, t('orgs.toast.deleted'))
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
