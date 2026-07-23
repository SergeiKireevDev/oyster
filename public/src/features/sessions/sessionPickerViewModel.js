import { parentSessionIdentity, runnerSessionIdentity, sessionIdentity } from "../../lib/sessionIdentity.js";

export const SESSION_ARCHIVE_AGE_MS = 2 * 24 * 60 * 60 * 1000;

/** Groups runners by working directory, with live processes first in stable runner order. */
export function groupRunnersByCwd(runners) {
  const groups = new Map();
  for (const runner of runners) {
    const cwd = runner.dir || "(unknown working directory)";
    if (!groups.has(cwd)) groups.set(cwd, { cwd, runners: [] });
    groups.get(cwd).runners.push(runner);
  }
  for (const group of groups.values()) {
    group.runners.sort((left, right) => Number(Boolean(right.alive)) - Number(Boolean(left.alive)));
  }
  return [...groups.values()];
}

/** Groups every persisted session by cwd and annotates sessions that own a runner. */
export function groupSessionsByCwd(sessions, runners) {
  const runnerByIdentity = new Map(runners.map((runner) => [runnerSessionIdentity(runner), runner]));
  const matchedRunners = new Set();
  const entries = sessions.map((session) => {
    const runner = runnerByIdentity.get(sessionIdentity(session)) ?? null;
    if (runner) matchedRunners.add(runner.id);
    return { session, runner };
  });
  for (const runner of runners) {
    if (!matchedRunners.has(runner.id)) entries.push({ session: null, runner });
  }

  const groups = new Map();
  for (const entry of entries) {
    const cwd = entry.session?.cwd || entry.runner?.dir || "(unknown working directory)";
    const environmentId = entry.session?.environmentId || entry.runner?.environmentId || null;
    const environmentName = entry.session?.environmentName || entry.runner?.environmentName || environmentId;
    const workspaceId = entry.session?.workspaceId || entry.runner?.workspaceId || null;
    const workspaceName = entry.session?.workspaceName || entry.runner?.workspaceName || workspaceId;
    const key = `${environmentId ?? ""}\u0000${workspaceId ?? ""}\u0000${cwd}`;
    if (!groups.has(key)) groups.set(key, {
      cwd,
      ...(environmentId ? { environmentId, environmentName } : {}),
      ...(workspaceId ? { workspaceId, workspaceName } : {}),
      entries: [],
    });
    groups.get(key).entries.push(entry);
  }
  for (const group of groups.values()) {
    group.entries.sort((left, right) => {
      const activity = Number(Boolean(right.runner?.alive)) - Number(Boolean(left.runner?.alive));
      if (activity) return activity;
      return String(right.session?.modifiedAt ?? "").localeCompare(String(left.session?.modifiedAt ?? ""));
    });
  }
  return [...groups.values()];
}

/** A stopped session is archived manually or when its latest head is older than two days. */
export function isSessionEntryArchived(entry, now = Date.now()) {
  if (!entry.session || entry.runner?.alive) return false;
  if (entry.session.archived) return true;
  const headTime = Date.parse(entry.session.modifiedAt ?? "");
  return Number.isFinite(headTime) && now - headTime > SESSION_ARCHIVE_AGE_MS;
}

/** Splits cwd groups while retaining their order and annotating the archived section boundary. */
export function partitionSessionGroupsByArchive(groups, now = Date.now()) {
  const recent = [];
  const archived = [];
  for (const group of groups) {
    const currentEntries = group.entries.filter((entry) => !isSessionEntryArchived(entry, now));
    const archivedEntries = group.entries.filter((entry) => isSessionEntryArchived(entry, now));
    if (currentEntries.length) recent.push({ ...group, entries: currentEntries, archived: false });
    if (archivedEntries.length) archived.push({ ...group, entries: archivedEntries, archived: true });
  }
  return [
    ...recent,
    ...archived.map((group, index) => ({ ...group, firstArchived: index === 0 })),
  ];
}

/** Nests search results under physical/cloud environments and their microVM workspaces. */
export function groupSessionSearchByHierarchy(groups, defaults = {}) {
  const environments = new Map();
  for (const group of groups) {
    const first = group.first ?? {};
    const environmentId = first.environmentId || defaults.environmentId || "local";
    const environmentName = first.environmentName || defaults.environmentName || environmentId;
    const workspaceId = first.workspaceId || defaults.workspaceId || "local";
    const workspaceName = first.workspaceName || defaults.workspaceName || workspaceId;
    if (!environments.has(environmentId)) environments.set(environmentId, {
      environmentId,
      environmentName,
      workspaces: new Map(),
    });
    const environment = environments.get(environmentId);
    if (!environment.workspaces.has(workspaceId)) environment.workspaces.set(workspaceId, {
      workspaceId,
      workspaceName,
      groups: [],
    });
    environment.workspaces.get(workspaceId).groups.push(group);
  }
  return [...environments.values()].map((environment) => ({
    ...environment,
    workspaces: [...environment.workspaces.values()],
  }));
}

/** Nests cwd categories under physical/cloud environments and microVM workspaces. */
export function groupSessionCwdsByHierarchy(groups, defaults = {}) {
  const environments = new Map();
  for (const group of groups) {
    const environmentId = group.environmentId || defaults.environmentId || "local";
    const environmentName = group.environmentName || defaults.environmentName || environmentId;
    const workspaceId = group.workspaceId || defaults.workspaceId || "local";
    const workspaceName = group.workspaceName || defaults.workspaceName || workspaceId;
    if (!environments.has(environmentId)) environments.set(environmentId, {
      environmentId,
      environmentName,
      workspaces: new Map(),
    });
    const environment = environments.get(environmentId);
    if (!environment.workspaces.has(workspaceId)) environment.workspaces.set(workspaceId, {
      workspaceId,
      workspaceName,
      recentGroups: [],
      archivedGroups: [],
    });
    const workspace = environment.workspaces.get(workspaceId);
    (group.archived ? workspace.archivedGroups : workspace.recentGroups).push(group);
  }
  return [...environments.values()].map((environment) => ({
    ...environment,
    workspaces: [...environment.workspaces.values()].map((workspace) => ({
      ...workspace,
      archivedCount: workspace.archivedGroups.reduce((count, group) => count + group.entries.length, 0),
    })),
  }));
}

/** Groups a flat session list into root sessions and their forks without mutating input. */
export function groupSessionFamilies(sessions) {
  const byIdentity = new Map(sessions.map((session) => [sessionIdentity(session), session]));
  const rootOf = (input) => {
    let session = input;
    const seen = new Set();
    while (parentSessionIdentity(session) && byIdentity.has(parentSessionIdentity(session)) && !seen.has(sessionIdentity(session))) {
      seen.add(sessionIdentity(session));
      session = byIdentity.get(parentSessionIdentity(session));
    }
    return session;
  };

  const families = new Map();
  for (const session of sessions) {
    const root = rootOf(session);
    const rootIdentity = sessionIdentity(root);
    if (!families.has(rootIdentity)) families.set(rootIdentity, { session: root, forks: [] });
    if (sessionIdentity(session) !== rootIdentity) families.get(rootIdentity).forks.push(session);
  }
  return [...families.values()];
}

/** Keeps each session family together in the active or inactive partition. */
export function partitionSessionFamilies(sessions, isAlive) {
  const active = [];
  const inactive = [];
  for (const family of groupSessionFamilies(sessions)) {
    const members = [family.session, ...family.forks];
    (members.some(isAlive) ? active : inactive).push(...members);
  }
  return { active, inactive };
}
