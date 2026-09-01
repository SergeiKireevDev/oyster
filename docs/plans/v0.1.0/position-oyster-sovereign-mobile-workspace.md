# Position Oyster as a Sovereign Mobile Workflow Workspace

## Goal

Establish Oyster as the self-hosted, mobile-first workspace for Pi: a system in
which open-ended work begins in conversation and repeated work gradually gains a
durable, purpose-built interface while canonical state remains on infrastructure
the user controls.

Use research as the first concrete market wedge without restricting the product
to research or presenting Oyster as a browser IDE. Make the public positioning
credible through shipped product behavior, real demonstrations, precise data
sovereignty claims, installable open-source releases, and evidence from design
partners.

The positioning hierarchy is:

- **Category:** self-hosted mobile workspace for Pi.
- **Promise:** keep agent work moving from anywhere without surrendering control
  of its durable state.
- **Mechanism:** conversations harden into routines, focused interfaces, and
  reusable workflows layer by layer.
- **Initial use case:** long-running research and recurring knowledge workflows.
- **Long-term vision:** a generalized sovereign workspace for agent-assisted
  work.

The concise product claim is:

> A workflow can start as a conversation on your server and become something
> reliable enough to operate from your phone.

## Target User

The initial ideal user is a technical researcher, independent operator, or small
self-hosting team that:

- already runs Pi on a workstation, home server, or private VPS;
- performs long-running investigations, monitoring, evaluation, or reporting;
- needs to capture, steer, review, approve, and rerun work away from a desk;
- values local custody of transcripts, files, credentials, and workflow state;
- is comfortable choosing between local inference and external model providers.

Do not initially position Oyster as a replacement for Notion, VS Code, a full
enterprise research platform, or a multi-harness agent orchestration platform.

## Product Philosophy

### The pearl principle

Novel work remains fluid inside Pi. Oyster adds a hard exterior only after a
workflow proves useful:

```text
open-ended prompt
  -> saved operation
    -> parameterized routine
      -> focused mobile interface
        -> reusable pearl
```

A **pearl** is the product abstraction for a repeatable workflow composed from
an inspectable procedure, explicit inputs, durable state, progress and attention
rules, outputs, and an optional focused interface. Until a packaged pearl format
ships, describe routines and hublots as the layers from which pearls form; do
not imply that an unimplemented packaging system exists.

### Mobile-first, not desktop-shrunk

Mobile-first means exposing the smallest interface required to operate a
workflow confidently:

- capture a question, URL, photograph, document, or voice note;
- start, stop, or rerun work;
- provide a small set of parameters;
- monitor progress and recover from interruption;
- review evidence and resulting artifacts;
- annotate a finding or request a correction;
- approve consequential actions;
- compare alternatives and choose the next branch;
- receive a notification only when judgment is needed;
- open a focused hublot when richer interaction is appropriate.

A general terminal and file editor may remain escape hatches, but typing shell
commands or reproducing a desktop IDE is not the primary mobile experience.

### Sovereignty

The server is authoritative for sessions, transcripts, files, application
metadata, routines, logs, hublot definitions, checkpoints, provenance,
annotations, and credentials owned by Pi. The browser is a control surface and
may retain only non-canonical presentation preferences and bounded caches.

Always distinguish:

- **sovereign storage:** where durable state and artifacts live;
- **sovereign execution:** where tools and workflows run;
- **sovereign inference:** where model inputs are processed.

Self-hosting Oyster provides the first two. The third is provided only when the
user selects a local model. Public copy and documentation must say when an
external model provider, tunnel provider, or other service can receive data.

## Vocabulary

Use these terms consistently:

- **Workspace:** a durable body of related work, not merely a filesystem path.
- **Investigation:** a session family pursuing a question or outcome.
- **Fork:** an alternative hypothesis, method, or continuation.
- **Routine:** a repeatable, inspectable execution with inputs, progress, logs,
  stop, and teardown semantics.
- **Hublot:** a focused web interface opened onto work running on the user's
  server; define this unfamiliar term on first use.
- **Artifact:** a durable output such as a report, source capture, dataset,
  chart, notebook, image, model result, or hublot snapshot.
- **Source:** captured evidence with origin and retrieval metadata.
- **Run:** one recorded execution of a routine or experiment.
- **Checkpoint:** a reversible state boundary.
- **Pearl:** a reusable workflow hardened from open-ended work layer by layer.

Prefer “crystallizes,” “hardens,” or “forms a durable layer” in primary marketing
copy. “Ossifies” may be used in the detailed philosophy, but not where it could
suggest that Oyster freezes accidental workflows prematurely.

## Guardrails

- Never market a feature as available until a user can complete its advertised
  journey in a released build.
- Maintain a claim-to-proof inventory linking every major marketing claim to a
  product path, test, demonstration, or explicit roadmap label.
- Never use fabricated users, testimonials, activity, search results presented
  as real, or generic placeholder links on a production site.
- Keep the open-ended Pi conversation as an escape hatch. Formalize only
  repeated, understood workflows.
- Keep generated workflows inspectable and exportable as ordinary scripts,
  configuration, and local files wherever possible.
- Do not create a second Pi session or credential store. Oyster-owned research
  metadata belongs in the separate `pi-lot-ui.sqlite` application database.
- Treat filesystem paths as storage locations, not durable artifact identity.
- Every consequential mobile mutation must be authenticated, report durable
  outcome honestly, and be reversible where the underlying operation permits.
- Every background operation must have durable status, bounded logs,
  cancellation behavior, and an actionable interrupted state.
- Preserve unrelated changes in both worktrees.
- Complete one unchecked implementation item per verified commit. Public-site
  and application changes may require coordinated commits in separate
  repositories; record both revisions in the verification result.
- After each application item, run:

```sh
npm run build
npm test
```

- After each marketing-site item, run:

```sh
npm run build
node --check src/main.js
node --check scripts/record-scroll.mjs
```

## Current Baseline and Gaps

The current Oyster application already supplies useful foundation:

- Pi-native sessions, persistence, forks, checkpoints, and exact-entry rollback;
- background routines with progress, logs, stop, teardown, and session binding;
- agent-created hublots with managed public interfaces;
- mobile-responsive transcript, session, credential, file, routine, and hublot
  controls;
- indexed session search and usage analytics;
- self-hosted application storage and Pi-owned credentials.

The current positioning is not yet fully substantiated:

- the application is still visually and structurally associated with coding
  sessions and directories;
- the marketing site uses product screenshots that read as coding-agent UI;
- `/home/ubuntu/oyster-marketing` is not currently version-controlled and its
  GitHub, documentation, and social links are placeholders;
- the application repository has no configured public remote or explicit root
  license file;
- installation and release paths are not yet suitable as public proof;
- “pearl” is a philosophy, not yet a formal product object;
- Oyster has no general artifact registry, source/citation model, provenance
  graph, or cross-artifact annotation model;
- mobile access lacks a complete attention, notification, capture, and PWA
  experience;
- sovereignty boundaries are explained across technical documentation but not
  yet presented as one clear public architecture.

## 1. Freeze the Positioning Foundation

- [ ] Add a canonical product-positioning document under `docs/product/` that
  records the category, promise, mechanism, initial use case, long-term vision,
  target user, exclusions, vocabulary, pearl principle, and approved concise
  claims from this plan. Link it from contributor documentation so application,
  docs, and marketing copy share one source of truth.
- [ ] Inventory current names and claims across package metadata, README,
  GitDocs, UI labels, screenshots, marketing pages, service files, and container
  labels. Decide where the implementation name `pi-lot-ui` remains appropriate
  and where the user-facing name must be Oyster; remove contradictory taglines
  and stale “coding-agent remote control” positioning.
- [ ] Add a machine-readable claim inventory for public marketing claims with
  fields for wording, status (`shipped`, `beta`, `roadmap`), supporting feature,
  test/demo evidence, data-boundary qualification, and owner. Add a validation
  test that fails for missing evidence IDs or production copy that references a
  roadmap-only claim without a roadmap label.
- [ ] Conduct and record at least five target-user interviews focused on mobile
  supervision, recurring research workflows, self-hosting expectations, and
  vocabulary comprehension. Use the findings to confirm or revise the initial
  wedge before expanding the homepage into additional audiences.

**Acceptance:** a contributor can derive consistent homepage, README, and UI
language from one positioning source; every prominent claim has a status and
proof path; interview findings either validate the selected wedge or explicitly
update this plan.

## 2. Establish Open-Source and Installation Credibility

- [ ] Decide the actual open-source license with the project owner, add the
  canonical license and notices to the application repository, and ensure
  package metadata, containers, generated docs, and marketing footer reflect
  exactly that decision. Do not infer a license from existing marketing copy.
- [ ] Put the marketing site under version control, either as a dedicated public
  repository or a clearly owned directory of the Oyster repository. Configure
  real remotes and replace generic `https://github.com`, `#` documentation, and
  placeholder social links with valid destinations or remove them.
- [ ] Provide one portable, documented installation path that a new user can
  execute without local hard-coded paths. Cover prerequisites, initial token
  handling, Pi discovery, persistent service operation, updates, backup, and
  uninstall/rollback. Keep Docker and native/systemd options explicit rather
  than silently substituting one for another.
- [ ] Add public CI for build, unit, documentation, container, and representative
  mobile/desktop e2e validation. Publish a versioned release with checksums,
  release notes, compatibility information, and an upgrade path.
- [ ] Add `SECURITY.md`, vulnerability-reporting instructions, supported-version
  policy, threat-boundary summary, and an operator checklist for exposing
  Oyster beyond a trusted LAN.
- [ ] Replace the homepage CTA with a real quick-start destination and verify a
  fresh machine can reach an authenticated Oyster session on desktop and phone
  by following only the public instructions.

**Acceptance:** a visitor can inspect the license and source, install a tagged
release, understand its security boundaries, and reach a functioning mobile
session without private paths or tribal knowledge. Every production link is
valid.

## 3. Replace Abstract Claims with Real Product Proof

- [ ] Define three reproducible demonstrations using only shipped Oyster
  capabilities: literature monitoring, comparative investigation, and a
  recurring evidence brief. Check in fixtures, routine scripts, prompts, and
  setup/teardown instructions without embedding private credentials or
  copyrighted source corpora.
- [ ] Build the literature-monitoring demonstration: collect a bounded public
  source set, show routine progress on mobile, present a focused evidence table
  through a hublot, and retain the resulting report in the session workdir.
- [ ] Build the comparative-investigation demonstration: fork two approaches,
  monitor both, search across findings, compare their conclusions in a hublot,
  and preserve a checkpoint before selecting a continuation.
- [ ] Build the recurring-brief demonstration: run a parameterized routine,
  disconnect the browser, reconnect from a phone, inspect its completion state,
  alter a parameter, and rerun it without using a shell.
- [ ] Record truthful desktop and mobile videos of the complete journeys. Keep
  network requests local or document each external dependency; include captions,
  reduced-motion alternatives, and descriptive poster images.
- [ ] Replace coding-oriented hero screenshots and simulated proof with frames
  from the real demonstrations. Show the loop
  `prompt -> background work -> mobile review -> hublot -> reusable routine`
  in sixty seconds or less.
- [ ] Add an automated demo smoke test that provisions fixtures, executes each
  bounded workflow with deterministic/mock model behavior where possible, and
  verifies that every screenshot/video state remains reachable in the current
  release.

**Acceptance:** the homepage's primary proof is a real end-to-end research
workflow, not conceptual copy or an IDE-shaped screenshot, and every depicted
state can be recreated from checked-in instructions.

## 4. Publish a Precise Sovereignty Architecture

- [ ] Add one canonical data-flow document and diagram covering browser, Oyster
  server, Pi process, application SQLite, Pi session/credential stores, workdir,
  model provider, tunnel provider, hublot service, and backup destinations.
- [ ] Publish a storage/execution/inference matrix that states which guarantees
  are provided in local-model, hosted-model, LAN-only, tunnelled, and public
  hublot configurations. Explicitly state that external model providers process
  content sent to them.
- [ ] Add authenticated operator-visible diagnostics that identify the current
  Pi executable, session backend, application database, inference provider,
  tunnel state, and non-secret credential source without exposing tokens,
  paths unnecessarily, or private artifact content.
- [ ] Document the browser boundary: canonical data remains server-side;
  `localStorage` contains only the auth bootstrap/token behavior already
  documented and non-canonical preferences; transient OAuth and research input
  values follow their existing secret-lifecycle rules.
- [ ] Review hublot defaults and public wording so an explicitly opened public
  interface is never described as private merely because Oyster itself is
  self-hosted. Surface scope, lifetime, owner session, and close controls on
  mobile.
- [ ] Add regression tests for the published boundary: no credential or
  transient secret reaches application SQLite, built assets, URLs, logs, SSE,
  or general preference storage; public diagnostics never return secret or
  content-bearing fields.
- [ ] Add a public “How data moves” page generated from the canonical document,
  and link it beside every data-sovereignty claim on the marketing site.

**Acceptance:** a technically sophisticated visitor can determine what stays on
the server, what may leave it, and which party is responsible in each deployment
mode. Marketing language does not conflate storage, execution, and inference.

## 5. Make Mobile Supervision the Defining Experience

- [ ] Audit every primary mobile journey—capture, session start, session switch,
  steer, stop, approval, credential setup, routine start/progress/stop/teardown,
  hublot open/use/close, checkpoint/fork, search, and reconnect—against touch
  size, one-handed reach, keyboard avoidance, interruption, and screen-reader
  criteria. Record and prioritize failures.
- [ ] Make Oyster installable as a PWA with correct application metadata, icons,
  standalone navigation, update behavior, and a safe service-worker strategy
  that never caches credentials, transient OAuth data, private API responses, or
  stale mutating requests.
- [ ] Add a durable attention inbox that aggregates only actionable states such
  as pending approval, requested input, failed/interrupted routine, completed
  result awaiting review, hublot recovery failure, and credential action. Avoid
  turning every stream event into a notification.
- [ ] Add opt-in completion and attention notifications with a self-hostable
  delivery design. Document what metadata reaches any push service, provide a
  no-third-party fallback, deduplicate events, and make notification links open
  the exact authenticated server-side state.
- [ ] Add a mobile capture entry point for text, URLs, files, photographs, and
  voice drafts. Uploads must be resumable or fail clearly, remain editable
  before submission, and bind to an explicit workspace/investigation.
- [ ] Ensure every long-running action survives page close and reports durable
  status after reconnection. Add process-level tests covering browser close,
  mobile background suspension, server restart where supported, and duplicate
  action prevention.
- [ ] Add a mobile judgment surface for bounded approvals, parameter forms,
  artifact review, annotations, and branch selection without requiring terminal
  input. Keep chat available for exceptional cases.
- [ ] Run accessibility and visual-regression coverage at representative narrow,
  notched, tablet, and desktop viewports with reduced motion, large text, and
  light/dark preferences.

**Acceptance:** a user can capture work, leave, receive one actionable signal,
review the result, approve or redirect it, and rerun it from a phone without a
terminal or loss of durable state.

## 6. Build the Research Workspace Foundation

### 6.1 Durable workspaces and investigations

- [ ] Design Oyster-owned `workspaces`, collections, and investigation/session
  associations in `pi-lot-ui.sqlite`. A workspace must have stable identity,
  title, question/description, status, timestamps, and optional tags while Pi
  retains ownership of session content and lineage.
- [ ] Add repositories, migrations, ownership/cascade rules, import behavior,
  and API contracts. Workspaces must not be reduced to cwd; one workspace may
  reference multiple directories and one directory may support multiple
  investigations.
- [ ] Add mobile-first workspace navigation and creation without removing the
  existing cwd/session-family views that remain useful technical context.

### 6.2 Artifact registry

- [ ] Design and implement an Oyster-owned artifact registry with stable ID,
  type, title, content hash, storage locator, media metadata, creator/producing
  session, producing run, timestamps, tags, and lifecycle status. Keep large
  content in validated filesystem/blob storage rather than duplicating it into
  arbitrary SQLite text fields.
- [ ] Support at minimum reports/text, PDFs, source captures, tabular data,
  images, charts, notebooks, generic files, and hublot snapshots or links.
  Unsupported media must degrade to safe metadata/download behavior.
- [ ] Add artifact registration to routine completion, file workflows, and
  hublot publication without treating every temporary file or log as a durable
  artifact.
- [ ] Add mobile artifact browsing, preview, search, download/export, and clear
  origin/produced-by metadata.

### 6.3 Provenance and sources

- [ ] Add typed provenance edges such as `derived_from`, `uses_source`,
  `produced_by_run`, `produced_by_session`, `compares`, and `supersedes`, with
  cycle policy, cascade behavior, and content hashes suitable for later
  verification.
- [ ] Add source capture with original URL/origin, retrieval timestamp, title,
  author/publisher when known, content hash, capture method, and snapshot
  locator. Preserve the distinction between a link, a captured copy, and a
  user-uploaded document.
- [ ] Add citation references from artifacts or claims to sources without
  inventing bibliographic metadata. Exports must retain resolvable source IDs
  and disclose missing snapshots.
- [ ] Add a provenance view that can trace a conclusion or artifact back through
  runs, sessions, inputs, and captured sources.

### 6.4 General annotations and comparison

- [ ] Design annotations that can target transcript entries, text ranges, PDF
  regions, image regions, table cells/ranges, artifact sections, runs, and
  whole artifacts. Support question, claim, evidence, objection, correction,
  task, and citation semantics without forcing all targets into line numbers.
- [ ] Preserve author, status, anchor snapshot, target revision/hash, and
  re-anchoring outcome. Never silently attach an annotation to a different
  revision when its anchor is ambiguous.
- [ ] Add an “address selected” workflow that sends structured annotations to
  Pi as a new turn and links the resulting session/run back to the annotations.
  “Addressed” must not imply independently verified correctness.
- [ ] Add generic comparison for two sessions, hypotheses, reports, datasets,
  model outputs, runs, or artifact revisions. Code diff may be one renderer,
  not the universal comparison model.

**Acceptance:** a research workspace can organize investigations independently
of cwd, register durable outputs, capture and cite sources, trace provenance,
annotate evidence, and compare alternatives while Pi remains authoritative for
its own sessions and credentials.

## 7. Formalize Pearls Without Creating a Proprietary Prison

- [ ] Write and review a pearl design that defines lifecycle, identity,
  versioning, inputs, routine reference/script, progress protocol, hublot/UI
  entry point, produced artifacts, attention rules, permissions, checkpoint
  policy, teardown, portability, and upgrade behavior.
- [ ] Define a human-readable, versioned manifest (for example `pearl.yaml`)
  with JSON-schema validation. The manifest must reference inspectable scripts
  and artifact contracts rather than embedding opaque executable state.
- [ ] Add “Save as routine” as the first promotion step from a successful
  conversation, requiring the generated script to satisfy the existing run,
  teardown, progress, security, and ownership protocol before saving.
- [ ] Add “Add controls” to derive a bounded parameter schema and focused
  interface from a routine. Require explicit user review of parameter types,
  defaults, secret treatment, destructive actions, and mobile labels.
- [ ] Add pearl installation, versioning, export, import, disable, and uninstall
  with a ledger of every created definition/materialization. Uninstall and
  teardown must identify and remove owned byproducts without deleting
  unrelated user artifacts.
- [ ] Add a gallery limited to locally installed and explicitly trusted pearls.
  Remote pearl installation must show source, requested capabilities, network
  needs, credentials, and teardown behavior before execution.
- [ ] Add one-click rerun from mobile with parameter confirmation, durable run
  identity, artifact links, attention events, and checkpoint creation when the
  workflow mutates reversible state.
- [ ] Convert the three canonical demonstrations into portable pearls only after
  the format and all underlying artifact/provenance capabilities ship.

**Acceptance:** a proven conversation can be promoted into an inspectable,
portable, versioned workflow and rerun from mobile without hiding implementation,
claiming unbounded permissions, or locking durable outputs into Oyster.

## 8. Publish Use-Case and Comparison Pages

- [ ] Add focused pages for literature review, research monitoring, competitive
  intelligence, model evaluation, personal knowledge ingestion, recurring
  reporting, and remote experiment supervision. Each page must show trigger,
  routine, mobile interaction, resulting artifact, data location, and rerun or
  reproduction path.
- [ ] Mark every use-case step as available, beta, or planned using the claim
  inventory. Do not use a future artifact/provenance flow in an “available now”
  demonstration before it ships.
- [ ] Publish a factual comparison covering Oyster, a remote terminal, a cloud
  agent platform, and a browser IDE across mobile supervision, canonical data
  location, self-hosting, open-ended work, workflow formalization,
  reversibility, and reliance on Git. Cite configurations where a competitor's
  behavior varies.
- [ ] Add a respectful Omnigent explanation: Omnigent brings many coding
  harnesses into a collaborative agent platform; Oyster turns work on a Pi
  server into sovereign, mobile-operable workflows. Do not claim categorical
  superiority or omit Omnigent self-hosting/mobile capabilities.
- [ ] Add structured metadata and search-oriented copy for the chosen category
  and use cases without reverting to generic “AI workspace” language. Keep the
  primary homepage concise and route detailed jobs to dedicated pages.
- [ ] Add a public roadmap that separates shipped foundation, active bets, and
  exploratory ideas. Link roadmap-only marketing language to it.

**Acceptance:** a visitor can recognize a concrete job, understand whether its
journey ships today, and explain Oyster's difference from terminals, cloud
agent platforms, and browser IDEs without relying on a feature-count contest.

## 9. Validate with Design Partners and Evidence

- [ ] Recruit five design partners matching the target-user definition and
  select one recurring, remotely supervised workflow for each. Record consent,
  privacy constraints, baseline process, and success criteria without checking
  private source material into the repository.
- [ ] Measure time from first prompt to reusable routine/pearl, percentage of
  meaningful interactions completed from mobile, rerun frequency,
  human-attention events per run, completion/recovery rate, artifacts produced,
  and reported time saved.
- [ ] Observe where users fall back to chat, desktop, terminal, or external
  tools. Treat those fallbacks as evidence: retain valuable escape hatches and
  formalize only repeated stable interactions.
- [ ] Publish at least two consented case studies with architecture, workflow,
  mobile moments, data boundary, before/after measurements, limitations, and a
  reproducible public analogue where private data prevents sharing the real
  workflow.
- [ ] Replace conceptual homepage proof with measured evidence only when the
  underlying methodology and sample size are disclosed. Do not present five
  design partners as broad market validation.
- [ ] Revisit the positioning document and roadmap after the five engagements;
  preserve the research wedge, narrow it, or choose a stronger recurring use
  case based on recorded behavior rather than preference.

**Acceptance:** positioning is supported by observed repeated use, not only
founder narrative, and product formalization follows stable user workflows.

## 10. Final Claim, Release, and Journey Validation

- [ ] Audit every public claim against the machine-readable inventory and the
  tagged release. Remove or relabel any unsupported statement, placeholder
  metric, generic link, simulated result, or ambiguous sovereignty promise.
- [ ] Validate all public links, metadata, captions, keyboard navigation,
  reduced motion, contrast, screen-reader landmarks, narrow viewport overflow,
  install flow, and desktop/mobile videos. Run Lighthouse or equivalent checks
  with documented thresholds and justified exceptions.
- [ ] Run a fresh-machine journey from public homepage to installation, Pi
  authentication, first mobile session, first routine, first hublot, disconnect,
  reconnect, and teardown. The tester must use only published material.
- [ ] Run the full application matrix and marketing build/recording matrix:

```text
# Oyster application
npm run build
npm test
cd tests/e2e && npm test

# Marketing site
npm run build
npm run record:scroll -- --duration=14000
```

- [ ] Publish the release, documentation, marketing update, demo fixtures, and
  claim inventory together. Record exact application, documentation, and site
  revisions in release notes.

## Completion Criteria

- Oyster is consistently described as the self-hosted mobile workspace for Pi,
  with research as a concrete wedge and generalized sovereign workflows as the
  long-term vision.
- The pearl principle is understandable, product-grounded, and never used to
  imply capabilities that have not shipped.
- A new user can inspect the license and source, install a tagged release,
  connect from a phone, and reproduce the flagship research demonstration.
- Public architecture distinguishes sovereign storage, execution, and inference
  and accurately discloses external model and tunnel providers.
- The mobile experience supports capture, background execution, actionable
  attention, review, approval, rerun, and recovery without requiring a terminal.
- Durable workspaces, artifacts, sources, provenance, annotations, comparisons,
  and eventually portable pearls make the research positioning true in the
  product rather than only in copy.
- Use-case and comparison pages are factual, status-labelled, and supported by
  reproducible demonstrations.
- At least five design-partner workflows and two consented case studies inform
  the final positioning, with limitations and sample size represented honestly.
- Every public claim maps to a shipped feature/test/demo or an explicit roadmap
  label, and all application, e2e, marketing, accessibility, and recording
  validation passes.
