## 2026-06-28 - Standardized Table Action Pattern
**Learning:** Administrative tables often require icon-only buttons for repetitive actions like "Copy ID" or "More Actions". These buttons lack inherent labels and can be confusing without tooltips. Standardizing these triggers with Radix Tooltips and localized aria-labels ensures a consistent, accessible experience across the entire management interface.
**Action:** Always wrap icon-only table actions in a `Tooltip` and provide a localized `aria-label`. Use a centralized `common` translation block for shared actions to ensure consistency and ease of maintenance.

## 2026-06-28 - Tooltip Testing with JSDOM
**Learning:** Radix Tooltip and DropdownMenu components often require a `TooltipProvider` context and may not behave correctly in JSDOM-based unit tests because they rely on pointer events or specific DOM structures.
**Action:** When unit testing components that use these primitives, provide a global mock in `jest.setup.ts` that implements a Passthrough for providers/containers and a Trigger that handles `asChild` by cloning the child and merging props. This prevents context errors and ensures the underlying interactive elements are still reachable in tests.
