# Current Styling Guidelines

This document records the visual language and implementation conventions currently established in the Svelte application. It is a reference for the style-unification work; it describes the application as it exists rather than proposing a new design system.

## Design direction

The current visual system is described in `public/src/style.css` as **“calm, spatial, and built for long coding sessions.”** Its main characteristics are:

- A dark, low-glare workspace with restrained indigo accents; an explicit light theme is also supported.
- Layered surfaces rather than strong decoration: page, panel, raised panel, subtle translucent fills, and occasional blur.
- Compact controls and metadata balanced by relatively spacious transcript content.
- Rounded geometry, usually `7–12px` for controls and cards, `13–17px` for floating surfaces, and pill radii only for badges or truly round controls.
- Fine, low-contrast borders and soft shadows. Accent color is reserved for selection, focus, progress, links, and primary actions.
- Short, quiet motion that communicates interaction or status without distracting from the coding session.

## Sources of truth and cascade

Global styling is imported by `public/src/main.js` from `public/src/style.css`. Most Svelte markup relies on global class contracts such as `.chip`, `.btn`, `.m-option`, `.m-actions`, and `.artifact-state`.

`style.css` currently has two historical layers:

1. The original rules at the start of the file establish layout and detailed feature styles.
2. The later **2026 visual system** section, beginning near line 2290, overrides those rules with the current visual language.

Because the later section wins through the cascade, use its effective values and patterns as the reference. Do not copy an older declaration merely because it appears first. When consolidating styles, prefer updating or reusing the effective shared rule instead of adding another override layer.

Most components should continue to use global shared classes. Component-scoped `<style>` blocks are currently limited to genuinely encapsulated or specialized rendering, including the header, application and folder icons, browser file entries, HTML/Markdown artifacts, and parts of the hublot UI. Use scoped styles when a rule belongs only to one component; use global styles when multiple components share the same visual role.

## Theme tokens

Use CSS custom properties instead of hard-coded colors whenever a semantic token exists.

| Token | Dark value | Light value | Purpose |
|---|---:|---:|---|
| `--bg` | `#0b0d12` | `#f5f7fb` | Page and deepest workspace background |
| `--panel` | `#11141b` | `#ffffff` | Primary panel surface |
| `--panel-2` | `#181c25` | `#eef2f7` | Raised controls and secondary surfaces |
| `--border` | `#252a36` | `#d5dce8` | Standard separators and borders |
| `--text` | `#f1f3f8` | `#202534` | Primary text |
| `--muted` | `#858da0` | `#667085` | Secondary text, metadata, placeholders |
| `--accent` | `#9da9ff` | `#5263d8` | Focus, selection, links, active state |
| `--accent-dim` | `#30375e` | `#dbe1ff` | Subtle accent backgrounds and borders |
| `--green` | `#78dba9` | `#237a57` | Success, online, completed |
| `--red` | `#ff7d91` | `#c43f58` | Error, destructive, stopped unexpectedly |
| `--yellow` | `#f5c66f` | `#956317` | Warning, pending, pausing |
| `--stopped` | `#343943` | `#aeb7c6` | Inactive/stopped status |
| `--user-bubble` | `#29315a` | `#e1e6ff` | User-message surfaces |
| `--selection-bg` | subtle 6% accent tint | theme-derived | Quiet selected/current background |
| `--selection-border` | 22% accent blended with border | theme-derived | Selected/current border |
| `--selection-marker` | translucent 48% accent | theme-derived | Thin non-color selection marker |
| `--selection-text` | 24% accent blended with text | theme-derived | Restrained selected/current text |
| `--surface-hover` | `#1d222d` | `#e9edf4` | Generic hover surface |
| `--shadow-lg` | `0 24px 64px rgba(0,0,0,.42)` | light equivalent | Menus, modals, major overlays |
| `--mono` | SFMono/Cascadia/Roboto Mono/Consolas | same | Code, paths, hashes, technical values |

`--sidebar-width` (`272px`) and `--rightbar-width` (`320px`) are layout tokens and contract to `238px` and `280px` at tablet widths.

The light theme is activated with `data-theme="light"` on the root element. New styling must work in both themes. Prefer semantic tokens and `color-mix()`; if a dark-theme literal or translucent white is necessary, add or verify a corresponding `html[data-theme="light"]` rule. Header-specific `--header-*` properties already provide this pattern.

## Typography

- Body text uses `Inter` when available, then the system sans-serif stack.
- Default text is `14px` with slightly tightened letter spacing (`-.006em`).
- Assistant transcript text is intentionally more spacious: approximately `14.5px/1.62` on desktop and `13.75px/1.52` on mobile.
- Use `var(--mono)` for code, terminal output, paths, hashes, identifiers, and aligned technical values—not for ordinary UI copy.
- Use weight and color before increasing font size. Common weights are roughly `560–680`; the UI avoids excessively bold copy.
- Secondary copy is generally `10–12px` and `var(--muted)`.
- Section kickers and status labels are typically `8–10px`, uppercase, bold, and letter-spaced around `.08–.16em`.
- Headings use tight tracking and concise hierarchy. Avoid introducing oversized display typography.
- Truncate single-line dynamic labels with `min-width: 0`, `overflow: hidden`, `text-overflow: ellipsis`, and `white-space: nowrap`.

## Spacing and layout

The CSS does not yet expose spacing tokens, but it consistently uses a compact scale:

- `2–4px`: tightly related inline elements and micro-details.
- `6–8px`: control internals and compact rows.
- `9–12px`: ordinary gaps, card padding, and grouped controls.
- `14–18px`: panel and modal padding.
- `20–40px`: major canvas spacing, especially the transcript.

Guidelines:

- Prefer flex or grid with `gap` over margins between children.
- Set `min-width: 0` on flexible children that may contain long session names, paths, model names, or URLs.
- Use `min-height: 0` on nested scrolling regions.
- Keep transcript content centered and readable; the current desktop message area is capped near `960px`.
- Sidebars are compact information rails. Avoid importing transcript-scale spacing into them.
- Account for `env(safe-area-inset-bottom)` in bottom-fixed mobile controls.

## Surfaces, borders, and elevation

- Use `var(--panel)` for primary structural panels and `var(--panel-2)` for controls or raised secondary surfaces.
- Current dark surfaces often use low-opacity white fills (`.025–.065`) or translucent panel backgrounds to create layers.
- Standard borders are `1px`; use `var(--border)` or a low-opacity theme-appropriate equivalent.
- Accent borders should be subtle when idle and stronger on hover, focus, active, or drop-target states.
- Reserve large shadows and backdrop blur for floating layers such as menus, modals, command palettes, and the floating composer.
- Cards may use a small soft shadow, but ordinary rows should remain flat.
- Use gradients sparingly for primary actions, selected conversation items, the user bubble, or ambient workspace depth—not as decoration on every surface.

### Radius conventions

- `6–8px`: tiny icon buttons, inline controls, code, and compact fields.
- `9–12px`: chips, rows, cards, inputs, and standard controls.
- `13–17px`: menus, modals, composer, and prominent floating surfaces.
- `999px` or `50%`: badges, progress tracks, status dots, and circular controls only.

## Controls and interaction states

### Shared control types

- `.chip`: secondary action. It is compact, low-emphasis, bordered, and usually about `30px` high with a `9px` radius. Prefer this for cancel, utility, filter, and inline actions.
- `.btn`: primary action. It is approximately `40px` high, uses the accent gradient, and carries stronger visual weight.
- `.btn.stop` or other destructive variants: use a restrained red tint and red text rather than a dominant solid red surface where possible.
- `.r-btn`: compact routine/sidebar action.
- `.m-option`: full-width selectable modal row. Active, keyboard-active, and current states use accent border/background treatment.

Reuse these classes rather than creating component-specific button systems for the same roles.

### Required states

Every interactive control should account for:

- **Default:** clear affordance without excessive accent color.
- **Hover:** subtle fill/border/color change; desktop controls may move by only `1–2px`.
- **Focus-visible:** the global convention is a `2px solid var(--accent)` outline with `2px` offset. Never remove it without an equally visible replacement.
- **Active/selected/current:** use the shared `--selection-*` tokens: a near-neutral low-opacity tint, a softly blended border, restrained text, and—where useful—a thin inset marker. Avoid saturated accent fills, glow, or fully accent-colored labels; do not communicate selection by color alone.
- **Disabled:** reduced opacity (currently about `.45`), default/not-allowed cursor, and no hover lift.
- **Loading:** spinner, pulsing status dot, progress bar, or explicit copy while retaining stable layout.
- **Error/destructive:** `--red`; **warning/pending:** `--yellow`; **success/online:** `--green`.

Use semantic elements (`button`, `a`, `input`, `summary`) and preserve keyboard behavior. Icon-only buttons require an accessible label and should generally provide a tooltip through `title` when useful.

### Icon-control sizing

Use the shared size tokens rather than independently enlarging icon buttons at mobile breakpoints:

- `--icon-control-dense` (`30px`): header actions and inline transcript utilities.
- `--icon-control-standard` (`34px`): ordinary icon-only navigation, download, pin, overflow, and reveal actions.
- `--icon-control-important` (`40px`): primary, destructive, session-lifecycle, and workspace power actions.
- `--icon-control-gap` (`4px`): minimum separation inside dense groups.

Keep glyphs at `14–16px` in most controls. Do not add margins to every child in a grouped control; use the parent gap so the group does not become visually oversized.

## Forms

- Inputs, textareas, and selects use panel/input surfaces, `1px` borders, `7–12px` radii, inherited typography, and primary text color.
- Common field heights are `34–40px`.
- Labels are generally small and muted, laid out as a grid with a `4–5px` gap.
- Focus changes the border to `--accent` or `--accent-dim`; some prominent fields add a soft accent focus ring.
- Technical input such as paths, account IDs, code, or tokens uses `var(--mono)`.
- Group related fields with grid layouts and collapse multi-column forms to one column near `600px`.
- Keep helper, validation, empty, and error text near the associated control. Do not rely on placeholder text as the only label.

## Modals, menus, and overlays

- The overlay uses a dark translucent scrim plus blur. It sits above slide-over sidebars and below toasts.
- A standard modal is full-width up to about `480px`, capped by viewport height, uses a `16px` radius in the current visual layer, and has a scrollable `.m-body`.
- Use `.wide` only when content genuinely needs the existing wider cap (`760px`). Specialized artifact readers may be wider.
- Keep modal structure consistent: `.m-title`, `.m-body`, content/options, then `.m-actions`.
- Modal actions wrap on narrow screens. The primary action uses `.btn`; cancellation and low-emphasis actions use `.chip`.
- Menus and command palettes use high-elevation panel surfaces, `13–14px` radii, subtle borders, blur, and `--shadow-lg`.
- Do not create a second overlay or modal visual vocabulary inside an individual component.

## Transcript and technical content

- User messages are right-aligned compact bubbles with a distinctive asymmetric radius and indigo-tinted surface.
- Assistant messages are largely borderless and optimized for reading rather than presented as cards.
- Thinking and tool activity are understated rows with status dots; expanded details use a subtle left guide rather than a heavy nested card.
- Markdown uses compact paragraph/list spacing, clear heading hierarchy, bordered inline code, and dark recessed code blocks.
- Syntax and diffs use the established semantic palette: green additions, red deletions/errors, muted metadata, and accent identifiers.
- Preserve whitespace and overflow behavior for logs, code, diffs, and paths. Use horizontal or contained scrolling rather than allowing technical content to break the whole layout.

## Icons and status indicators

- Prefer the shared `AppIcon` component for application actions and `FolderIcon` for folders instead of adding emoji or mismatched icon sets.
- Icons generally inherit `currentColor`, allowing hover, disabled, status, and theme states to work automatically.
- Typical action icons are `14–16px`; use the shared dense, standard, and important icon-control tokens for their containers.
- Status dots are small (`6–8px`) and map to semantic tokens.
- Glow is reserved for live/busy/current signals and the brand. Static decorative glow should be avoided.
- Accompany unfamiliar status color with text, shape, or accessible status copy.

## Motion

- Interaction transitions are usually `120–160ms`; larger carousel/sidebar transitions may be longer.
- Animate only transform, opacity, color, border, background, shadow, or measured progress where practical.
- Hover lift is restrained to `1–2px`.
- Pulsing and glowing animations indicate active work, recording, loading, or a live connection—not decoration.
- All new motion must honor the existing global `prefers-reduced-motion: reduce` rule. Functionality and state must remain understandable when animation is effectively disabled.

## Responsive behavior

The principal breakpoints currently in use are:

- `1080px`: narrower desktop/tablet side rails and transcript padding.
- `760px`: mobile layout; sidebars become slide-over/carousel panels, messages and composer tighten, and some controls increase their touch area.
- `600px` and `520px`: complex forms, analytics, and grouped modal content collapse or wrap.

Style mobile deliberately rather than depending on accidental wrapping. Preserve readable content, reachable actions, and scrolling within the viewport. Text actions and important or destructive icon actions should approach a `40px` touch target; dense and ordinary icon-only controls use the shared `30px` and `34px` sizes with at least `4px` separation.

## Accessibility and content guidance

- Maintain sufficient contrast in both dark and light themes. `--muted` is for supporting text, not essential low-size instructions on a similar background.
- Never use color as the only indicator of selected, invalid, running, or completed state.
- Preserve global keyboard focus treatment and logical tab order.
- Use `aria-live`, `role="status"`, or `role="alert"` for asynchronous state only where updates need announcement; existing artifact and toast components demonstrate the pattern.
- Use concise labels. Put secondary explanation in muted helper copy instead of crowding control text.
- Ensure icon-only controls have `aria-label`; decorative icons should be hidden from assistive technology.
- Test zoom, long names, long paths, translated-length text, and narrow viewports.

## Style-unification checklist for a component

When reviewing a component in `style-unification.md`:

1. Identify its visual role: structural panel, content, card, selectable row, form, overlay, primary action, secondary action, or status.
2. Compare it with existing components serving the same role, especially shared `.chip`, `.btn`, `.m-option`, `.m-actions`, sidebar, transcript, and artifact patterns.
3. Replace hard-coded colors with semantic tokens where possible and verify both dark and light themes.
4. Align typography, spacing, radius, border, elevation, icon size, and state styling with the conventions above.
5. Remove one-off decoration or duplicated rules rather than adding a new style vocabulary.
6. Verify hover, focus-visible, selected/current, disabled, loading, empty, error, and success states as applicable.
7. Check desktop, `1080px`, and mobile (`760px` and below), including overflow and touch behavior.
8. Verify reduced-motion behavior and keyboard/screen-reader semantics.
9. Preserve existing behavior; styling cleanup should not alter component logic unless needed to correct an interaction or accessibility defect.
10. Run the project test suite after changes (`npm test`, followed by the repository’s complete validation suite when the unit of work is complete).

## Known implementation cautions

- The visual system is not fully tokenized. Some effective current rules still contain theme-specific literals and therefore have explicit light-theme counterparts.
- A few variables are feature-specific or defined only in a theme/context. Do not assume every custom property found through search is a globally safe token.
- The global stylesheet is large and order-dependent. Check the later cascade before deciding which declaration is active.
- Svelte scoped styles cannot automatically replace a global class contract used across many components. Consolidate at the correct level.
- Avoid broad element selectors inside component styles; prefer a component root and role-based classes to prevent accidental coupling.
- Do not add `scroll-behavior: smooth` to the transcript. Programmatic transcript positioning depends on immediate scroll updates; deliberate permalink navigation requests smooth scrolling explicitly.
