## 2026-07-05 - Standardized Table Action Tooltips
**Learning:** Icon-only buttons in administrative tables (e.g., 'more_vert' for actions, 'content_copy' for IDs) lack sufficient context for sighted users and can be confusing for screen readers if not explicitly labeled and hinted. Nesting `TooltipTrigger` and `DropdownMenuTrigger` (both as `asChild`) is a compatible pattern in this design system.
**Action:** Always wrap icon-only table actions in a `Tooltip` and provide localized `aria-label`s. Use shared localization keys like `common.moreActions` and `common.copy` for consistency.
