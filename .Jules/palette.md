## 2025-05-15 - [Standardized Loading State for Buttons]
**Learning:** Adding a `loading` prop to core button components prevents manual and inconsistent implementations (like swapping text for "...") and ensures accessibility by automatically setting `aria-busy` and `disabled`.
**Action:** Always check if the base `Button` component supports a `loading` state before implementing manual loading indicators in forms or dialogs.

## 2025-05-15 - [Radix UI Slot and Loading Indicators]
**Learning:** When adding a loading spinner to a component that uses Radix UI's `Slot` (`asChild`), the spinner must be conditionally omitted if `asChild` is true to avoid rendering multiple children into the `Slot`, which causes Radix to throw an error.
**Action:** Use `{asChild ? children : <>{loading && <Spinner />}{children}</>}` pattern for `asChild` compatible components.
