# Palette UX Journal

## 2025-05-30 - [Standardizing Loading States]
**Learning:** Adding a `loading` prop to the core `Button` component ensures consistent UX across the app. It's crucial to handle `asChild` correctly by omitting the spinner when the button is used as a Slot to avoid Radix UI rendering errors. Also, preferring SVG icons like Lucide over font-based icons like Material Symbols for core UI components avoids external dependency issues.
**Action:** Use the `loading` prop instead of manual state-based text/icon rendering for async actions. Ensure `aria-busy` is set and the button is disabled.
