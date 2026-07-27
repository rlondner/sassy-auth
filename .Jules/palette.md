## 2026-07-09 - Standardized Loading States
**Learning:** Manual loading indicators (like "...") are inconsistent and less accessible than a standardized `loading` prop that handles both visual feedback (spinner) and accessibility (`aria-busy`).
**Action:** Use the `loading` prop on `Button` and `AlertDialogAction` instead of manual ternary text logic for all async operations.

## 2026-07-27 - Password Visibility Toggle and Testing Hooks
**Learning:** Implementing interactive show/hide password toggles requires strict HTML id/label pairings, precise focus-visible outlines for keyboard accessibility, and Tailwind right-padding classes on inputs to avoid text overlapping with icon buttons. Additionally, testing Next.js 15 / React 19 forms with `useActionState` inside a React 18 JSDOM environment is made seamless by mocking `react` to simulate the hook with normal React `useState` hooks.
**Action:** Always wrap password inputs in relative containers, add secure right-padding (`pr-10`) to accommodate absolute icon toggles, and use standard React mocks for React 19-specific server state hooks in Jest environments.
