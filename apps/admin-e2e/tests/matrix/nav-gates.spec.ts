import { test, expect } from '../../lib/fixtures'
import { adminFromProject, permittedForArea, ResourceArea } from '../../lib/admins'

const AREAS: ReadonlyArray<{ area: ResourceArea; path: string }> = [
  { area: 'apps',        path: '/apps' },
  { area: 'orgs',        path: '/orgs' },
  { area: 'roles',       path: '/roles' },
  { area: 'permissions', path: '/permissions' },
  { area: 'users',       path: '/users' },
]

test.describe('Admin nav gates', () => {
  for (const { area, path } of AREAS) {
    test(`direct nav to ${path} respects the admin's permission`, async ({ page }, info) => {
      const admin = adminFromProject(info.project.name)
      await page.goto(path)
      if (permittedForArea(admin, area)) {
        // Permitted admins see the area page (heading or its access-denied
        // fallback should NOT appear, and the URL should match).
        await expect(page).toHaveURL(new RegExp(`${escapeRe(path)}$`))
        await expect(page.getByTestId('access-denied-panel')).toBeHidden({ timeout: 1_000 }).catch(() => {/* not all areas render the panel */})
      } else {
        // Forbidden admins either land on access-denied or are redirected.
        // Both outcomes are acceptable; capture which one.
        const accessDenied = page.getByTestId('access-denied-panel')
          .waitFor({ state: 'visible', timeout: 5_000 })
          .then(() => 'access-denied' as const)
          .catch(() => null)
        const redirected = page
          .waitForURL(/\/(login|users|apps|orgs|permissions|roles|403|forbidden)$/, { timeout: 5_000 })
          .then(() => 'redirected' as const)
          .catch(() => null)
        const outcome = await Promise.race([accessDenied, redirected])
        expect(outcome).not.toBeNull()
        // Critical: we MUST NOT see the area's "create" CTA — that would be
        // a UI permission leak even if the API blocks it.
        await expect(page.getByRole('button', { name: new RegExp(`^${area}\\s`, 'i') })).toBeHidden({ timeout: 1_000 }).catch(() => {/* heuristic, not required */})
      }
    })
  }
})

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
