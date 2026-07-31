## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-31 - Sidebar Footer Interactive Controls Focus Ring & Touch Targets
**Learning:** Icon-only interactive controls (like theme toggles and logout buttons) and compact dropdown triggers in dark sidebars often lack focus-visible rings and adequate touch targets/padding. Adding `focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar` with rounded-md paddings and smooth transitions ensures beautiful contrast, seamless keyboard navigation (WCAG Focus Visible compliance), and clear interactive feedback.
**Action:** Always apply standard focus-ring utilities and hover transitions to all sidebar controls to preserve focus indicator visibility and navigation ease.
