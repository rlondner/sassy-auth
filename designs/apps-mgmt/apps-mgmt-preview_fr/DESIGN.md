---
name: Slate & Indigo
colors:
  surface: '#f8f9ff'
  surface-dim: '#cbdbf5'
  surface-bright: '#f8f9ff'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#eff4ff'
  surface-container: '#e5eeff'
  surface-container-high: '#dce9ff'
  surface-container-highest: '#d3e4fe'
  on-surface: '#0b1c30'
  on-surface-variant: '#464555'
  inverse-surface: '#213145'
  inverse-on-surface: '#eaf1ff'
  outline: '#777587'
  outline-variant: '#c7c4d8'
  surface-tint: '#4d44e3'
  primary: '#3525cd'
  on-primary: '#ffffff'
  primary-container: '#4f46e5'
  on-primary-container: '#dad7ff'
  inverse-primary: '#c3c0ff'
  secondary: '#565e74'
  on-secondary: '#ffffff'
  secondary-container: '#dae2fd'
  on-secondary-container: '#5c647a'
  tertiary: '#3130c0'
  on-tertiary: '#ffffff'
  tertiary-container: '#4b4dd8'
  on-tertiary-container: '#d9d8ff'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e2dfff'
  primary-fixed-dim: '#c3c0ff'
  on-primary-fixed: '#0f0069'
  on-primary-fixed-variant: '#3323cc'
  secondary-fixed: '#dae2fd'
  secondary-fixed-dim: '#bec6e0'
  on-secondary-fixed: '#131b2e'
  on-secondary-fixed-variant: '#3f465c'
  tertiary-fixed: '#e1e0ff'
  tertiary-fixed-dim: '#c0c1ff'
  on-tertiary-fixed: '#07006c'
  on-tertiary-fixed-variant: '#2f2ebe'
  background: '#f8f9ff'
  on-background: '#0b1c30'
  surface-variant: '#d3e4fe'
typography:
  headline-lg:
    fontFamily: Manrope
    fontSize: 30px
    fontWeight: '700'
    lineHeight: 36px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Manrope
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Manrope
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Manrope
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Manrope
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Manrope
    fontSize: 13px
    fontWeight: '400'
    lineHeight: 18px
  label-md:
    fontFamily: Manrope
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
  label-sm:
    fontFamily: Manrope
    fontSize: 11px
    fontWeight: '700'
    lineHeight: 14px
    letterSpacing: 0.03em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  pane-nav: 260px
  pane-master: 380px
  pane-detail: auto
  gutter: 1px
  container-padding: 24px
  stack-sm: 8px
  stack-md: 16px
  stack-lg: 32px
---

## Brand & Style
This design system is engineered for high-density administrative environments that require the aesthetic polish of a premium editorial publication. The brand personality is authoritative, precise, and sophisticated, evoking an emotional response of organized control and clarity. 

The style utilizes a **Corporate Modern** foundation infused with **Minimalist** constraints. It prioritizes information hierarchy through deliberate whitespace, crisp borders, and a restricted color palette. The visual language avoids decorative trends in favor of functional elegance, ensuring that complex data sets remain legible and actionable without overwhelming the user.

## Colors
The palette is centered on a professional "Slate & Indigo" theme. The primary Indigo serves as the interactive anchor, used for calls to action, active states, and primary brand accents. The Slate neutrals provide the structural framework, using various weights to define depth and importance.

*   **Primary (Indigo):** Used for primary buttons, active navigation markers, and focus states.
*   **Neutral (Slate):** A scale from 50 to 900 defines the UI. Backgrounds use the lightest tints to separate panes, while the darkest tints are reserved for high-contrast typography.
*   **Semantic Colors:** Status indicators for user management (Active, Pending, Suspended) use de-saturated versions of Emerald, Amber, and Rose to maintain the editorial tone while providing clear functional cues.

## Typography
The system exclusively uses **Manrope** to bridge the gap between geometric modernity and functional legibility. 

The scale is optimized for data density. Large headlines are reserved for section headers to maintain an editorial "title" feel, while body-md (14px) and body-sm (13px) are the primary drivers for table data and administrative details. Labels utilize SemiBold or Bold weights with increased letter spacing and uppercase transformations to clearly distinguish metadata from primary content. Line heights are kept tight (1.4x - 1.5x) to ensure maximum vertical information density.

## Layout & Spacing
The layout follows a strict **Three-Column Fixed Pane** model to manage complexity. 
1.  **Navigation Pane (Left):** A narrow, high-contrast Slate sidebar for global app switching.
2.  **Master Pane (Middle):** A list or search interface for object selection (e.g., User List), utilizing a subtle background shift (Slate 50).
3.  **Detail Pane (Right):** The primary workspace where data entry and editorial content reside, utilizing a clean white background.

Separation is achieved through **1px Slate-200 borders** rather than wide gutters or shadows, maximizing the usable horizontal area. Content within panes follows an 8px base grid, ensuring consistent vertical rhythm in data-heavy forms and tables.

## Elevation & Depth
Depth is conveyed through **Tonal Layers** and **Low-Contrast Outlines**. This system rejects heavy shadows to maintain its "flat-editorial" aesthetic.

*   **Level 0 (Canvas):** The base background (Slate 50).
*   **Level 1 (Panes):** Defined by 1px borders in Slate-200.
*   **Level 2 (In-page Containers):** White surfaces used for cards or form groups within the Detail Pane, also outlined in Slate-200.
*   **Interaction Overlay:** Only subtle, highly diffused shadows (4px blur, 5% opacity) are used for dropdown menus and modals to indicate they are temporary floating elements. 

Active states in lists are indicated by a 2px vertical Indigo bar on the leading edge of the item, rather than an overall elevation increase.

## Shapes
The shape language is **Soft (0.25rem)**. This subtle rounding provides a modern, approachable touch to an otherwise rigid administrative interface without sacrificing the professional "grid-based" feel. 

Buttons, input fields, and status chips all share this consistent radius. Smaller elements like checkboxes and radio buttons maintain this precision, ensuring the UI feels cohesive and systematic. For large dashboard modules or modals, a `rounded-lg` (0.5rem) may be used to provide a slightly softer container for high-level content.

## Components
Consistent component styling is critical for administrative efficiency:

*   **Buttons:** Primary buttons are solid Indigo with white text. Secondary buttons use a Slate-200 border and Slate-900 text. Ghost buttons are reserved for low-priority actions in dense tables.
*   **Status Chips:** Small, pill-shaped indicators with a light background tint and high-contrast text (e.g., a soft green background with dark emerald text).
*   **Input Fields:** Minimalist design with a 1px Slate-200 border. On focus, the border transitions to Indigo with a subtle 1px Indigo inner-shadow.
*   **Data Tables:** Row heights are compact (40px-48px). Headers use `label-md` with a Slate-100 background. Zebra-striping is avoided in favor of subtle 1px horizontal dividers.
*   **User Avatars:** Circular, using high-quality imagery or Slate-based initials to maintain the sophisticated tone.
*   **Side Navigation:** Uses high-contrast Slate-900 backgrounds with Slate-300 icons, transitioning to Indigo for the active state.