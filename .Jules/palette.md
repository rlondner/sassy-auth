## 2025-05-15 - [Radix UI Slot and Loading States]
**Learning:** When components support Radix UI's `asChild` prop (which uses the `Slot` component), they must not inject additional DOM elements (like a loading spinner) when `asChild` is true. `Slot` expects exactly one child element; providing more causes a runtime crash: "React.Children.only expected to receive a single React element child."
**Action:** Always conditionally render loading indicators only when `asChild` is false. Ensure the component still correctly forwards the `disabled` and `aria-busy` states to the slotted child.
