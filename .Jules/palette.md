## 2025-05-15 - Standardized Loading States for Buttons and Dialogs
**Learning:** Manual text-based loading indicators (like "...") are inconsistent and lack visual polish. Providing a first-class `loading` prop in core components ensures accessibility (`aria-busy`), consistency (same spinner everywhere), and safer implementation (automatic disabling and `asChild` compatibility).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual state/text toggling for all async operations.
