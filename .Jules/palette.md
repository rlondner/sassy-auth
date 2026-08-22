## 2026-08-22 - Standardize Button Async Operations
**Learning:** Auth forms using manual ternary text logic (e.g. `{submitting ? '…' : t('submit')}`) lack the standard spinning loader icon and `aria-busy="true"` attribute provided by `@sassy-auth/ui`'s `Button` component with the `loading` prop.
**Action:** Always prefer `<Button loading={isPending}>{t('submit')}</Button>` over `{isPending ? '…' : t('submit')}` across all admin authentication and form submit actions.
