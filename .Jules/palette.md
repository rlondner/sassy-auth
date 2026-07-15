## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-15 - Tooltip and DropdownMenu Composition
**Learning:** When wrapping a DropdownMenuTrigger with a Tooltip, both must use the `asChild` prop to correctly merge props onto a single underlying button element without creating nested interactive elements.
**Action:** Use the pattern `<Tooltip><TooltipTrigger asChild><DropdownMenuTrigger asChild><button ...>` for icon-only action triggers.
