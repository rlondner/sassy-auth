## 2024-06-01 - Loading state for primary buttons
**Learning:** Primary action buttons (like Login or Submit) often lacked clear feedback during async operations, relying on generic text like "..." which can be hard to see or inconsistent.
**Action:** Added a `loading` prop to the core `Button` component that uses a Material Symbol spinner and automatically disables the button. This ensures consistent UX across the app.
