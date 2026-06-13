# Palette's Journal - Critical UX & Accessibility Learnings

## 2025-05-15 - [Consistent "More Actions" UX]
**Learning:** Icon-only buttons (like `more_vert`) without explicit ARIA labels or tooltips are inaccessible and lack discoverability. Standardizing these across all administrative tables with i18n-ready labels and tooltips improves both accessibility for screen readers and clarity for all users.
**Action:** Always wrap `DropdownMenuTrigger` containing icon-only buttons with a `Tooltip` and ensure the `button` has a descriptive `aria-label`.
