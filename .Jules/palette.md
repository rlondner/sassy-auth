## 2026-06-19 - Standardized row actions with tooltips
**Learning:** Standardized row action buttons (vertical ellipsis) should always have an `aria-label` and a `Tooltip` to ensure both accessibility for screen readers and clarity for sighted users. Using a common translation key (`common.moreActions`) across all tables maintains consistency.
**Action:** When creating new data tables with row actions, always wrap the action trigger in a `Tooltip` and provide a localized label.
