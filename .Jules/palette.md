## 2025-05-15 - [Standardized Loading States]
**Learning:** Manual text-based loading indicators (like "...") are inconsistent and less accessible than a visual spinner combined with `aria-busy`. Using a standardized `loading` prop across `Button` and `AlertDialogAction` ensures visual and behavioral consistency.
**Action:** Always prefer the `loading` prop on UI components for async operations. Ensure `asChild` support is handled by conditionally omitting the spinner to avoid Radix UI Slot conflicts.
