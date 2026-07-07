# Palette's Journal - Critical UX & Accessibility Learnings

## 2025-05-15 - TooltipProvider Missing in Root Layout
**Learning:** Radix UI Tooltips (used via @sassy-auth/ui) require a `TooltipProvider` context to function correctly. This was missing in the `apps/admin` root layout, causing tooltips to be non-functional.
**Action:** Always verify the presence of `TooltipProvider` in the root layout when working with tooltips in a new application or if tooltips are not appearing.
