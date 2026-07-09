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

  /**
   * Filter the table to a single row via the client-side global-filter
   * search box. Keeps row lookups robust against pagination once demo
   * seed data pushes the target row off the first page.
   */
  async search(query: string) {
    const box = this.page.getByPlaceholder(t('users.search'))
    await box.fill('')
    await box.fill(query)
  }

  async createUser({
    firstName, lastName, email, orgName,
  }: { firstName: string; lastName: string; email: string; orgName: string }) {
    await this.createButton.click()
    const drawer = this.page.getByRole('dialog')
    await drawer.getByLabel(t('users.fields.firstName')).fill(firstName)
    await drawer.getByLabel(t('users.fields.lastName')).fill(lastName)
    await drawer.getByLabel(t('users.fields.email')).fill(email)
    // The org field is a Radix combobox whose accessible name is its
    // placeholder ("Select org"), not the visible "Organization" label,
    // so getByLabel can't match it. Target the combobox by role instead.
    await drawer.getByRole('combobox').first().click()
    await this.page.getByRole('option', { name: orgName }).click()
    // The create-user drawer's submit label is `users.drawer.create` (not createTitle).
    await drawer.getByRole('button', { name: t('users.drawer.create') }).click()
    // On success the drawer swaps the form for an invite-link panel; there is
    // no success toast to await. Dismiss it via "Done" to return to the table.
    await drawer.getByRole('button', { name: t('users.drawer.done') }).click()
    // Filter to the new row so callers/assertions find it regardless of
    // which table page it would otherwise land on.
    await this.search(email)
  }

  async editUser(email: string, patch: { firstName?: string; lastName?: string }) {
    await this.search(email)
    // Row actions are inside a DropdownMenu triggered by the more-actions button
    // (users-table's trigger has no aria-label, so target the Radix attribute).
    await this.rowByEmail(email).locator('[aria-haspopup="menu"]').click()
    // The "Edit" menu item opens the View drawer; the drawer's header has its
    // own Edit button that toggles edit mode before the fields become inputs.
    await this.page.getByRole('menuitem', { name: t('users.actions.edit') }).click()
    const drawer = this.page.getByRole('dialog')
    await drawer.getByRole('button', { name: t('users.drawer.edit') }).click()
    // In edit mode the view drawer renders its labels as plain <p> elements
    // that are not associated with the inputs, so getByLabel can't match.
    // The editable text fields render in a fixed order: First Name, Last Name,
    // Phone, Username — target the first two positionally.
    if (patch.firstName !== undefined) {
      await drawer.getByRole('textbox').nth(0).fill(patch.firstName)
    }
    if (patch.lastName !== undefined) {
      await drawer.getByRole('textbox').nth(1).fill(patch.lastName)
    }
    await drawer.getByRole('button', { name: t('users.drawer.save') }).click()
    await raceSuccessOrError(this.page, t('users.toast.updated'))
    // Save keeps the drawer open in view mode (showing the now-stale prop)
    // while the table refreshes underneath. Close it so the refreshed row is
    // visible, then re-filter (the refresh clears the global filter).
    await this.page.keyboard.press('Escape')
    await drawer.waitFor({ state: 'hidden' })
    await this.search(email)
  }

  async deleteUser(email: string) {
    await this.search(email)
    await this.rowByEmail(email).locator('[aria-haspopup="menu"]').click()
    await this.page.getByRole('menuitem', { name: t('users.actions.delete') }).click()
    await this.page
      .getByRole('alertdialog')
      .getByRole('button', { name: t('users.confirmDelete.button') })
      .click()
    await raceSuccessOrError(this.page, t('users.toast.deleted'))
  }

  async resendInvitation(email: string) {
    await this.search(email)
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
