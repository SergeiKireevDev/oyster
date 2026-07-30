# Project-Oriented Workspaces and Sessions

## Purpose

Oyster currently reflects its execution substrate in the product model: an
environment contains a workspace, a workspace exposes a Linux filesystem, and
sessions are grouped by their current working directory. That model is precise
for operators, but it makes the product feel like a remote shell or file
browser. Users must understand paths, machines, repositories, and process
placement before they can organize their work.

A domain-oriented Oyster should instead answer these questions first:

- What body of work am I responsible for?
- What outcome are we pursuing?
- Which conversations, sources, runs, and outputs belong together?
- What should I review or do next?
- Where did this result come from?

Linux remains the execution foundation and an important escape hatch, but it
should not be the primary information architecture.

## Design principle

> A project owns the meaning of work. A runtime supplies compute. A session is
> a conversation within the project. Filesystem paths are implementation
> locators, not product identity.

This separates three concerns that are currently easy to conflate:

1. **Domain organization:** projects, goals, threads, artifacts, and activity.
2. **Execution:** isolated runtimes, processes, tools, and credentials.
3. **Storage:** repositories, checkouts, files, blobs, and external services.

The separation does not remove low-level capability. It places that capability
behind the project model and exposes it deliberately when needed.

## Recommended vocabulary

### Project

A **project** is the primary user-facing container for a durable body of related
work. It has stable identity independent of any directory, machine, or Git
repository.

Examples:

- “Authentication redesign”
- “Q3 competitor analysis”
- “Weekly literature monitor”
- “Home energy optimization”

A project contains a brief, goals, threads, resources, artifacts, routines,
runs, decisions, and activity. It may outlive every runtime and repository that
has supported it.

### Runtime

A **runtime** is an execution boundary: a local Oyster installation, VM,
microVM, container, or remote agent. This is approximately what Oyster Hub
currently calls a workspace.

A runtime has operational properties:

- lifecycle: provisioning, online, paused, unavailable, or destroyed;
- provider and region;
- filesystem and execution capabilities;
- resource limits;
- network policy;
- credential availability;
- health and last contact.

“Create a cloud workspace” therefore becomes “Create a runtime” or, in the
normal project flow, “Add compute.” Runtime details belong in project settings
and operator views rather than the primary navigation.

### Thread

A **thread** is the user-facing form of a Pi session: one coherent conversation
or line of inquiry within a project.

Examples:

- “Map the current authentication flow”
- “Compare passkeys with emailed magic links”
- “Address review feedback”

A thread owns conversational continuity and lineage. It does not own a Linux
working directory. When a turn needs execution, Oyster records which runtime
and project resources were used.

“Session” may remain the Pi protocol and persistence term. The UI can say
“thread,” while the implementation maintains a one-to-one or one-to-many
mapping to Pi sessions.

### Resource

A **resource** is something a project can use. It has a stable project-scoped
identity and a typed adapter. Initial resource types could include:

- source repository;
- checkout;
- uploaded document or dataset;
- managed storage area;
- external URL or captured source;
- database or service connection;
- credential reference;
- runtime attachment.

A resource may have a path internally, but most UI and agent interactions refer
to its ID and title. For example, users select “Product repository” and
“Customer interview corpus,” not `/home/ubuntu/tree-pi` and
`/mnt/data/interviews`.

### Checkout

A **checkout** is a usable view of a source repository on a runtime. It can be a
normal clone or a Git worktree. The domain model records repository, revision,
branch, runtime, and lifecycle while the adapter manages the corresponding
Linux path.

This gives worktrees a useful product meaning:

- “Main checkout”
- “Passkey experiment”
- “Release verification”

The raw path and `.git` topology remain available in the technical inspector.

### Artifact

An **artifact** is a durable output worth keeping and reviewing: a report,
dataset, patch, chart, image, source capture, notebook, build, or exported
bundle. It has a stable ID, type, title, content hash, provenance, and storage
locator.

Not every file is an artifact. Temporary files, caches, dependencies, and logs
remain implementation details unless explicitly promoted.

### Routine and run

A **routine** is a reusable procedure. A **run** is one recorded execution of a
routine or other bounded operation. Runs belong to projects and record their
inputs, runtime, progress, logs, outputs, and final state.

## Proposed domain model

```text
Project
├── Brief and goals
├── Threads
│   ├── Messages
│   ├── Forks
│   └── execution records ───────────┐
├── Resources                        │
│   ├── repositories                 │
│   ├── checkouts ───────────────┐   │
│   ├── datasets                 │   │
│   └── service references       │   │
├── Routines                       │   │
├── Runs ─────────────────────────┼───┤
├── Artifacts                      │   │
├── Decisions                      │   │
└── Activity                       │   │
                                   ▼   ▼
                                Runtime
                                   │
                                   ▼
                         Linux processes and storage
```

The important relationship is that a project can use multiple runtimes and a
runtime can host multiple projects where policy permits. A secure deployment
may enforce one dedicated runtime per project; a local deployment may share one
runtime across many projects. The domain model should support both without
making either topology visible in ordinary navigation.

## Project record

A minimal project could contain:

```ts
interface Project {
  id: string;
  title: string;
  summary?: string;
  status: "active" | "paused" | "completed" | "archived";
  goals: ProjectGoal[];
  tags: string[];
  defaultRuntimeId?: string;
  createdAt: string;
  updatedAt: string;
}
```

The default runtime is a convenience, not identity. Deleting or replacing it
must not delete the project record, threads, artifact metadata, or provenance.

## Thread record

```ts
interface Thread {
  id: string;
  projectId: string;
  title: string;
  purpose?: string;
  status: "open" | "waiting" | "resolved" | "archived";
  parentThreadId?: string;
  branchPoint?: string;
  piSessionRef: string;
  selectedResourceIds: string[];
  createdAt: string;
  updatedAt: string;
}
```

A thread should bind to project context, not to `cwd`. Each execution record can
retain exact technical context for reproducibility:

```ts
interface ExecutionContext {
  runtimeId: string;
  resourceBindings: Array<{
    resourceId: string;
    revision?: string;
    locatorSnapshot?: string;
  }>;
  workingLocator?: string;
  environmentFingerprint?: string;
}
```

`workingLocator` may contain a Linux path, but it is diagnostic and historical.
It is not how the sidebar groups threads.

## Project context for the agent

Opening a thread should construct bounded, explicit context from the project:

1. project brief and active goals;
2. thread purpose and lineage;
3. selected resources and their capabilities;
4. relevant artifact summaries and decisions;
5. active routine or run state;
6. runtime capabilities only when execution is required.

Oyster should not attach the entire project history or filesystem by default.
Users and agents can add resources to the thread as needed. This keeps context
understandable and makes it possible to explain why the agent could access a
particular source or service.

Resource references presented to Pi should include both a stable semantic name
and a resolved technical locator:

```text
Resource: Product repository (resource repo_product)
Checkout: Passkey experiment
Runtime: Isolated project runtime
Resolved path: /srv/oyster/checkouts/passkey-experiment
```

The first three lines are durable project concepts. The final line is ephemeral
execution detail.

## User experience

### Primary navigation

The main navigation becomes:

```text
Projects
└── Authentication redesign
    ├── Overview
    ├── Threads
    ├── Outputs
    ├── Automations
    ├── Resources
    └── Activity
```

The project overview should emphasize:

- brief and desired outcome;
- current goals;
- open questions and waiting items;
- recent threads;
- artifacts ready for review;
- active or failed runs;
- recent decisions.

It should not begin with a folder picker.

### Starting work

The primary action is **New thread**, followed by a question such as “What do
you want to accomplish?” Oyster selects the project's default resources and
runtime. Advanced controls can change them before execution.

When a project has no compute, the action becomes **Set up compute**. When it
has no source repository, the agent can still perform research, accept uploads,
or create artifacts in managed project storage.

### Resources instead of filesystem roots

A resource screen could show:

```text
Product repository       GitHub · main · connected
Passkey experiment       Checkout · feature/passkeys · active
Interview corpus         18 documents · indexed
Staging service          HTTPS service · credential configured
Project storage          2.4 GB
```

Selecting a repository opens domain actions such as status, branches,
checkouts, compare, sync, and create thread. “Browse files” remains available as
one secondary action.

### Technical inspector

Low-level access should remain available through a clearly labeled technical
inspector containing:

- runtime identity and health;
- resolved filesystem paths;
- file explorer;
- terminal or command execution;
- environment details;
- Git plumbing and worktree paths;
- logs and raw tool calls.

This is progressive disclosure, not capability removal. Technical users and Pi
retain full Linux access, while most workflows do not require users to organize
their work around it.

## Repositories, clones, and worktrees

Repository operations should be expressed in project terms:

- **Add source repository** clones or attaches a repository as a resource.
- **Create checkout** creates a clone or worktree based on runtime capabilities
  and policy.
- **Start parallel approach** creates a thread plus an isolated checkout.
- **Compare approaches** compares artifacts, decisions, commits, or checkout
  state.
- **Remove checkout** removes the checkout after showing uncommitted and
  unexported work.

The repository adapter resolves these actions to native Git commands on the
runtime. Oyster must not emulate Git through generic file operations. The raw
Git executable and terminal remain the escape hatch for unsupported operations.

A checkout should have its own stable identity:

```ts
interface CheckoutResource {
  id: string;
  projectId: string;
  repositoryResourceId: string;
  runtimeId: string;
  title: string;
  strategy: "clone" | "worktree";
  branch?: string;
  revision: string;
  locator: string;
  status: "creating" | "ready" | "dirty" | "missing" | "removing";
}
```

The locator is mutable. Moving a checkout must not break links from threads,
runs, or artifacts.

## Artifacts instead of arbitrary files

The normal output flow should be:

1. Pi or a routine writes data using ordinary Linux tools.
2. It registers selected outputs as project artifacts.
3. Oyster records type, title, content hash, producing thread/run, source
   resources, and storage locator.
4. The project UI presents the artifact using an appropriate renderer.
5. Download, export, reveal-in-files, and open-terminal-here remain available.

This preserves open file formats and ordinary tools without making directory
layout the user-facing catalog.

Artifacts should survive path changes. A moved file updates its locator; an
artifact ID and its provenance remain stable. For stronger durability, Oyster
may copy promoted artifacts into managed content-addressed project storage while
retaining the original locator.

## API shape

A project-oriented API could expose:

```text
GET    /api/v2/projects
POST   /api/v2/projects
GET    /api/v2/projects/{project}
PATCH  /api/v2/projects/{project}

GET    /api/v2/projects/{project}/threads
POST   /api/v2/projects/{project}/threads
POST   /api/v2/threads/{thread}/forks

GET    /api/v2/projects/{project}/resources
POST   /api/v2/projects/{project}/resources
POST   /api/v2/repositories/{resource}/checkouts

GET    /api/v2/projects/{project}/artifacts
POST   /api/v2/projects/{project}/artifacts
GET    /api/v2/artifacts/{artifact}/content

GET    /api/v2/projects/{project}/runs
POST   /api/v2/projects/{project}/routines/{routine}/runs

GET    /api/v2/runtimes
GET    /api/v2/runtimes/{runtime}/capabilities
```

Filesystem and process APIs remain runtime-scoped technical APIs:

```text
GET    /api/v2/runtimes/{runtime}/fs/list
POST   /api/v2/runtimes/{runtime}/transfers
POST   /api/v2/runtimes/{runtime}/exec
```

Project operations resolve resource IDs to runtime operations on the server.
The browser should not have to combine host IDs and absolute paths to perform a
normal project action.

## Ownership and lifecycle

The model needs explicit deletion semantics:

- Archiving a project hides it but preserves its domain records.
- Deleting a thread follows Pi session ownership policy and does not silently
  delete artifacts.
- Removing a resource detaches it after checking dependent threads, runs, and
  artifacts.
- Destroying a runtime does not delete a project, but marks runtime-backed
  locators unavailable.
- Removing a checkout must detect dirty state and unregistered outputs.
- Deleting an artifact removes metadata first only when content retention policy
  allows it; shared content-addressed blobs require reference counting.

Every artifact and run should record enough provenance to explain missing or
destroyed infrastructure without pretending the content remains available.

## Authorization model

Project membership and runtime access should be distinct capabilities. A future
multi-user deployment could grant someone permission to review project
artifacts without granting shell access to its runtime.

Useful capability groups are:

- view project and threads;
- contribute to threads;
- review or approve outputs;
- manage resources and credentials;
- run routines;
- browse technical files;
- execute arbitrary commands;
- manage or destroy runtimes.

This separation becomes impossible if “can open project” implicitly means “has
shell-equivalent access to its machine.”

## Migration from the current model

The change can be incremental.

### Phase 1: add projects without removing anything

- Add Oyster-owned project records.
- Associate existing Pi sessions with a project through a separate mapping.
- Add stable runtime IDs for the objects currently called Hub workspaces.
- Keep `cwd`, workspace ID, and existing file APIs unchanged as technical data.
- Introduce a project switcher alongside the existing session view.

For migration, Oyster can suggest one project for each current
`(workspace, cwd)` group, but users should be able to merge or rename the
results. The inferred project must receive a new stable ID rather than using the
path as its ID.

### Phase 2: introduce resources and artifacts

- Let users attach existing directories and repositories as named resources.
- Register pinned documents and routine outputs as artifacts where appropriate.
- Change new-thread creation to select project resources rather than a folder.
- Retain “choose folder” under advanced resource attachment.

### Phase 3: make projects primary

- Replace environment/workspace/cwd hierarchy in the main sidebar with projects
  and threads.
- Move runtimes, paths, and file browsing to project settings and the technical
  inspector.
- Use resource names in tool displays while preserving raw invocation details.
- Add project overview, output, automation, and activity views.

### Phase 4: rename infrastructure concepts

- Introduce `/api/v2/runtimes` while maintaining `/api/v1/workspaces` as a
  compatibility API.
- Update Hub and provider UI language from workspace provisioning to runtime or
  compute provisioning.
- Keep adapters so existing clients and bookmarked routes continue to work
  during the transition.

## Decisions to preserve

A domain-oriented redesign should preserve these Oyster properties:

- Pi remains authoritative for session transcripts and credentials.
- Oyster-owned relationships and metadata live in Oyster's application store.
- Canonical artifacts remain exportable in ordinary formats.
- Git operations use native Git in the runtime.
- Linux files and arbitrary execution remain available to authorized users.
- Runtime isolation remains a security boundary.
- Browser state is not canonical.
- Paths are never treated as durable project or artifact identity.

## Anti-patterns

Avoid the following shortcuts:

1. **Renaming a directory “project.”** This retains path identity and prevents a
   project from spanning repositories, datasets, or runtimes.
2. **Renaming the current cloud workspace “project.”** This couples durable work
   to disposable compute.
3. **Putting every file in the artifact registry.** That recreates a file
   explorer with more metadata and floods the domain model with temporary state.
4. **Hiding paths without adding resources.** Cosmetic path removal leaves users
   unable to understand or control what context the agent can access.
5. **Reimplementing Git through a virtual file API.** Clone, worktrees, locks,
   hooks, and repository metadata should remain native runtime behavior.
6. **Making a thread own one checkout forever.** Threads may analyze several
   resources, and a checkout may support several threads.
7. **Deleting domain state with compute.** Runtime destruction must degrade a
   project gracefully rather than erase its meaning and history.

## Example journey

A user creates **Authentication redesign** and adds a Git repository. Oyster
provisions an isolated runtime and creates the named resource **Product
repository**. The raw clone path is not shown.

The user starts a thread, **Map the current login flow**. Pi receives the project
brief and access to the product repository. It produces an architecture note,
which is registered as an artifact.

The user then chooses **Start parallel approach** twice. Oyster creates two
threads and two checkout resources backed by Git worktrees: **Passkey approach**
and **Magic-link approach**. Each thread records the checkout revision and
runtime used for its tool executions.

A comparison routine consumes both checkout resources and their artifacts. Its
run produces a decision table linked to the source threads and commits. From a
phone, the user reviews the table and marks the passkey approach as the selected
decision.

At any point, an authorized technical user can open the inspector, see the exact
worktree paths, run native Git commands, browse hidden files, or use a terminal.
Those capabilities remain complete, but they no longer define how the work is
organized.

## Summary

The central shift is from:

```text
environment → machine workspace → directory → session → files
```

to:

```text
project → threads, resources, runs, and artifacts
                    │
                    └── runtime-backed execution when needed
```

This makes Oyster understandable in terms of outcomes and durable work while
preserving Linux, Git, uploads, clones, worktrees, and arbitrary low-level
operations as powerful implementation capabilities beneath the domain model.
