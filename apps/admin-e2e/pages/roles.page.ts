import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class RolesPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    // PageHeader renders the title inside <BreadcrumbPage> (role="link",
    // aria-current="page"), not as a heading element. Match that marker.
    this.heading = page.locator('[aria-current="page"]').filter({ hasText: t('roles.title') })
    this.createButton = page.getByRole('button', { name: t('roles.create') })
    this.accessDenied = page.getByRole('heading', { name: t('apps.accessDenied.title') })
  }

  async goto() {
    await this.page.goto('/roles')
  }

  rowByName(name: string): Locator {
    return this.page.getByRole('row', { name: new RegExp(escapeRe(name)) })
  }

  /** Filter the table via its search box so row lookups tolerate pagination. */
  async search(query: string) {
    const box = this.page.getByPlaceholder(t('roles.search'))
    await box.fill('')
    await box.fill(query)
  }

  async createRole({ name, appName }: { name: string; appName: string }) {
    await this.createButton.click()
    const drawer = this.page.getByRole('dialog')
    await drawer.getByLabel(t('roles.fields.name')).fill(name)
    // The app field is a native <select>; use selectOption rather than
    // clicking options (native <option>s are not "visible" to Playwright).
    await drawer.getByLabel(t('roles.fields.app')).selectOption({ label: appName })
    await drawer.getByRole('button', { name: t('roles.drawer.createTitle') }).click()
    await raceSuccessOrError(this.page, t('roles.toast.created'))
    await this.search(name)
  }

  async editRole(name: string, patch: { name?: string }) {
    await this.search(name)
    // Row actions are inside a DropdownMenu triggered by the "more actions" button.
    await this.rowByName(name).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('roles.actions.edit') }).click()
    const drawer = this.page.getByRole('dialog')
    if (patch.name !== undefined) {
      await drawer.getByLabel(t('roles.fields.name')).fill(patch.name)
    }
    await drawer.getByRole('button', { name: t('roles.drawer.save') }).click()
    await raceSuccessOrError(this.page, t('roles.toast.updated'))
    if (patch.name !== undefined) await this.search(patch.name)
  }

  async deleteRole(name: string) {
    await this.search(name)
    await this.rowByName(name).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('roles.actions.delete') }).click()
    await this.page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('roles.confirmDelete.button') })
      .click()
    await raceSuccessOrError(this.page, t('roles.toast.deleted'))
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
