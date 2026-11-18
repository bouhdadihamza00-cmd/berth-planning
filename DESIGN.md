# Portside interface system

Portside is an operations application for planners, operators and administrators. Screens prioritize tasks, current state and traceable records. Use Impeccable's Operate guidance, Taste Skill's consistency principles, Emil Kowalski's interaction guidance, Modern Web Guidance and Ponytail. Marketing layouts, decorative entrances and invented data do not apply.

## Identity and surfaces

Keep the navy header and navigation rail, blue selection and focus, orange primary actions, and semantic operational status colors. The logo and selected port stay visible. The rail expands over the workspace on hover or keyboard focus.

Shared tokens live in `frontend/preferences.css`, after workspace styles. Light canvas: `#f2f6f9`; surface: white; soft surface: `#f7fafc`; ink follows the existing navy token; secondary text: `#526c7e`. Dark mode uses corresponding navy surfaces and light text. Card outlines separate content; controls have stronger boundaries. Cards use a 9px radius, controls 5–6px. Avoid redundant nested containers.

## Typography and spacing

Use the existing Segoe UI/system sans family. Page headings share a 24px reference size, section headings 14px, controls and table content 12px, and compact metadata 11px. All authored sizes scale through `--ui-font-scale`; mobile field text is at least 16px. The user's 11–18px setting remains authoritative. Preserve natural heights and wrapping as text grows.

Use 8px gaps within actions, 12–16px internal spacing and 20–24px between distinct sections. Align titles and actions on common edges. Keep forms, reports and analytical workspaces naturally scrollable. Dense operational tables and the timeline may use their own scroll regions. Do not clip text to conceal overflow.

## Controls, tables and states

Use orange for the primary action, neutral surfaces for secondary actions, and clearly named red actions for removal. Keep removal beside configuration/edit actions. Independent configuration forms save independently and preserve other drafts. Do not imply a connector or model is live when only its definition is saved.

Use native form controls and dialogs. Inputs have visible labels, validation and clear boundaries. Tables use column-header scope and preserve native horizontal scrolling where their content requires it. Navigation, focus, selection, disabled, loading, error, empty and success states must be distinguishable. Status is communicated with text or icons as well as color.

## Accessibility and responsive behavior

Provide a keyboard skip link to the workspace heading. Preserve focus across dialogs and updates; decorative icons do not add spoken noise. Focus uses a visible outline. Respect reduced motion, dark mode, high contrast and forced colors. Coarse-pointer targets are at least 44px. Keep tabs on one horizontally scrollable row and support arrow, Home and End navigation.

Verify desktop, laptop and mobile layouts, 18px text, long labels, empty workspaces, both themes and permission-limited controls. The map uses compact overlays; keep weather and controls in separate content-sized rows. Do not change browser zoom or saved user preferences as part of a design update.

## Copy and data

Routine copy is concise and professional. Keep validation, operational status, essential provenance and confirmations. Put secondary explanations behind disclosure. Do not add provider/model diagnostics, implementation commentary, unsupported trends or fabricated forecasts to routine screens. Never publish customer data or screenshots; repository examples use isolated synthetic records.
