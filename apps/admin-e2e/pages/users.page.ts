import type { Page, Locator } from '@playwright/test'
import { t } from '../lib/i18n'

export class UsersPage {
  readonly page: Page
  readonly heading: Locator
  readonly createButton: Locator
  readonly accessDenied: Locator

  constructor(page: Page) {
    this.page = page
    // PageHeader renders the title inside <BreadcrumbPage> (role="link",
    // aria-current="page"), not as a heading element. Match that marker.
    this.heading = page.locator('[aria-current="page"]').filter({ hasText: t('users.title') })
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
    const drawer = this.page.getByRole('dialog')
    await drawer.getByLabel(t('users.fields.firstName')).fill(firstName)
    await drawer.getByLabel(t('users.fields.lastName')).fill(lastName)
    await drawer.getByLabel(t('users.fields.email')).fill(email)
    await drawer.getByLabel(t('users.fields.org')).click()
    await this.page.getByRole('option', { name: orgName }).click()
    // The create-user drawer's submit label is `users.drawer.create` (not createTitle).
    await drawer.getByRole('button', { name: t('users.drawer.create') }).click()
    await raceSuccessOrError(this.page, t('users.toast.created'))
  }

  async editUser(email: string, patch: { firstName?: string; lastName?: string }) {
    // Row actions are inside a DropdownMenu triggered by the more-actions button
    // (users-table's trigger has no aria-label, so target the Radix attribute).
    await this.rowByEmail(email).locator('[aria-haspopup="menu"]').click()
    // The "Edit" menu item opens the View drawer; the drawer's header has its
    // own Edit button that toggles edit mode before the fields become inputs.
    await this.page.getByRole('menuitem', { name: t('users.actions.edit') }).click()
    const drawer = this.page.getByRole('dialog')
    await drawer.getByRole('button', { name: t('users.drawer.edit') }).click()
    if (patch.firstName !== undefined) {
      await drawer.getByLabel(t('users.fields.firstName')).fill(patch.firstName)
    }
    if (patch.lastName !== undefined) {
      await drawer.getByLabel(t('users.fields.lastName')).fill(patch.lastName)
    }
    await drawer.getByRole('button', { name: t('users.drawer.save') }).click()
    await raceSuccessOrError(this.page, t('users.toast.updated'))
  }

  async deleteUser(email: string) {
    await this.rowByEmail(email).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('users.actions.delete') }).click()
    await this.page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('users.confirmDelete.button') })
      .click()
    await raceSuccessOrError(this.page, t('users.toast.deleted'))
  }

  async resendInvitation(email: string) {
    await this.rowByEmail(email).locator('[aria-haspopup="menu"]').click()
    await this.page
      .getByRole('menuitem', { name: t('users.actions.resendInvitation') })
      .click()
    await raceSuccessOrError(this.page, t('users.toast.resent'))
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
