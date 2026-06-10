## 2025-05-15 - [Unified Loading States in UI Components]
**Learning:** When implementing loading states in UI components that support `asChild` (via Radix UI Slot), the loading indicator should be conditionally omitted when `asChild` is true to prevent rendering multiple children into the Slot, which would cause a runtime error.
**Action:** Always check for `asChild` before rendering supplementary UI like spinners or icons in base components.
