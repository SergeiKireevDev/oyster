# Svelte Code Smells Checklist

Use this checklist during component reviews and refactors. Check an item only when
matching code has been removed, made safe, or retained with a documented reason
and focused test.

## Markup and Rendering

- [ ] No component injects hard-coded markup with `{@html}`, `innerHTML`,
  `outerHTML`, or `insertAdjacentHTML`; express static markup as Svelte markup or
  a component instead.
- [ ] Every necessary `{@html}` value comes from a centralized renderer and is
  sanitized before reaching the component; raw user, model, URL, or file content
  is never injected directly.
- [ ] Repeated or conditional markup is extracted when it represents a reusable
  concept, not copied across branches or components.
- [ ] Complex template expressions are moved into named derived values or pure
  helpers rather than embedding business logic in markup.
- [ ] Each list that can reorder, insert, or remove items uses a stable keyed
  `{#each}` block; array indexes are not used as identity.
- [ ] Browser-only or asynchronous content has an explicit loading, empty,
  failure, and recovery state where applicable.

## Reactivity and State

- [ ] Components do not mix Svelte 5 runes with legacy reactive APIs without a
  documented migration boundary.
- [ ] Derived values use `$derived` (or a pure function) rather than `$effect`
  that writes secondary state.
- [ ] `$effect` is reserved for synchronizing with an external system and has
  cleanup for every timer, listener, subscription, observer, or resource it
  creates.
- [ ] Effects do not form write-after-read loops, depend on accidental reads, or
  hide ordering requirements between multiple effects.
- [ ] Props are not copied into local state unless the component intentionally
  owns an editable snapshot and defines how later prop updates are handled.
- [ ] Props and context values are not mutated behind their owner's back;
  changes flow through callbacks, bindings with clear ownership, or scoped
  service operations.
- [ ] State is kept as local as possible; module-level mutable state and global
  stores are not used merely to avoid passing props or context.
- [ ] Destructuring does not accidentally discard reactivity, and callbacks do
  not retain stale snapshots of reactive values.

## Component Boundaries

- [ ] Components render and coordinate UI rather than performing fetches,
  persistence, authentication, process control, or cross-feature workflows
  directly.
- [ ] Large components are not acting as feature routers with many unrelated
  branches, imports, stores, or action handlers.
- [ ] Reusable children receive focused props, snippets, or scoped context
  instead of importing a parent's feature state and actions globally.
- [ ] Context services are created per application mount and cleaned up on
  unmount; mutable singleton callback registries are avoided.
- [ ] Events and callbacks describe user intent rather than exposing DOM details
  or requiring global `window` custom-event buses.
- [ ] Components do not construct tokenized URLs, interpret protocol responses,
  or duplicate domain rules that belong in adapters or feature services.

## DOM, Lifecycle, and Browser APIs

- [ ] Direct DOM queries and imperative node creation are avoided when Svelte
  bindings, actions, transitions, or declarative markup can express the same
  behavior.
- [ ] Every `window`, `document`, media-query, observer, and element listener has
  a lifecycle owner and deterministic cleanup.
- [ ] Timers, animation frames, subscriptions, object URLs, and abortable work
  are canceled or released when the component is destroyed or superseded.
- [ ] Browser globals and storage are accessed behind an SSR-safe boundary or in
  lifecycle code, not unconditionally during module initialization or render.
- [ ] Async handlers handle rejection and stale completion; an older request
  cannot overwrite newer state after navigation, replacement, or unmount.
- [ ] `bind:this` is not used as an escape hatch for routine data flow or to
  call undocumented child internals.

## Accessibility and Interaction

- [ ] Interactive behavior uses native `button`, `a`, `input`, and other
  semantic elements instead of clickable `div` or `span` elements.
- [ ] Controls have accessible names, keyboard behavior, visible focus, and
  correct disabled semantics; click-only interactions are avoided.
- [ ] Forms use labels, appropriate input types, native submission, and useful
  validation messages rather than ad hoc keyboard and click handling.
- [ ] Dialogs manage focus entry, focus trapping, Escape behavior, restoration,
  and an accessible title.
- [ ] Dynamic status, error, and progress updates use appropriate live-region
  semantics without producing noisy announcements.
- [ ] Images, icons, and media have correct alternatives; decorative content is
  hidden from assistive technology.

## Styling and Maintainability

- [ ] Components do not rely on broad `:global(...)` selectors, fragile DOM
  depth, or unrelated global class names when scoped styles or explicit design
  tokens suffice.
- [ ] Inline styles and unexplained magic numbers are replaced with named state,
  classes, or shared tokens when they encode reusable behavior or layout rules.
- [ ] Duplicate component styles and markup are consolidated without creating a
  premature, overly configurable abstraction.
- [ ] Suppressed Svelte or accessibility warnings are narrow, justified beside
  the suppression, and covered by a test where behavior is non-obvious.
- [ ] Dead props, handlers, imports, selectors, and compatibility branches are
  removed rather than retained speculatively.

## Performance and Testing

- [ ] Render-time work is bounded; expensive parsing, sorting, filtering, and
  serialization are derived once or moved outside hot template paths.
- [ ] Large collections use suitable pagination, virtualization, or incremental
  rendering, and updates do not recreate every row unnecessarily.
- [ ] High-frequency input, resize, scroll, and pointer handlers are bounded and
  do not trigger avoidable global state updates or network requests.
- [ ] Components do not create fresh heavyweight services, renderers, or data
  structures on every reactive update.
- [ ] Tests assert user-visible behavior, accessibility, lifecycle cleanup, and
  feature boundaries rather than only snapshots or implementation details.
- [ ] Every retained exception to this checklist has a focused regression test
  that demonstrates why the lower-level or imperative approach is necessary.

## Suggested Audit Searches

```sh
rg -n '\{@html|innerHTML|outerHTML|insertAdjacentHTML' public/src --glob '*.svelte'
rg -n 'window\.|document\.|localStorage|sessionStorage' public/src --glob '*.svelte'
rg -n 'addEventListener|setInterval|setTimeout|requestAnimationFrame|URL\.createObjectURL' public/src --glob '*.svelte'
rg -n "<(div|span)[^>]*(onclick|on:click|role=['\"]button)" public/src --glob '*.svelte'
rg -n 'svelte-ignore' public/src --glob '*.svelte'
```
