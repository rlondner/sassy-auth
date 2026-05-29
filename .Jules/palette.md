## 2025-05-22 - [Dynamic ARIA labels for Copy Feedback]
**Learning:** Screen reader users need auditory feedback when an action like "Copy to Clipboard" is successful. Simply changing the icon visually is not enough.
**Action:** Use a dynamic `aria-label` that switches from "Copy" to "Copied!" when the action is successful. This ensures the screen reader announces the state change.

## 2025-05-22 - [Accessibility for Icon-only Buttons]
**Learning:** Icon-only buttons (like "Close", "More actions") are completely inaccessible to screen reader users if they lack an `aria-label`.
**Action:** Always provide a translated `aria-label` for buttons that do not have visible text labels.
