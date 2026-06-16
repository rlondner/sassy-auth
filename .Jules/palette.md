## 2025-05-15 - [Consistent Table Row Actions]
**Learning:** Standardizing icon-only buttons with tooltips and localized ARIA labels significantly improves both visual clarity and accessibility across the admin console. Using a shared 'common.moreActions' key ensures consistency.
**Action:** Always wrap icon-only table actions in a Tooltip and provide a localized aria-label. Ensure TooltipProvider is available in the root layout and test helpers.

## 2025-05-15 - [CI/CD Dependencies]
**Learning:** Workspace packages in a pnpm monorepo must be built (tsc) before they can be consumed by other apps in CI, as Next.js/NestJS often expect the 'dist/' folder to exist.
**Action:** Always run 'pnpm exec turbo build --filter=!@sassy-auth/auth-server' (or relevant filter) after install in GitHub Actions.
