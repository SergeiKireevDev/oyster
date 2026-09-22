import { homedir } from "node:os";
import { createCodexSessionStateReader } from "../../runner-drivers/codex-session-model.mjs";
import { unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
const MILLISECONDS_PER_SECOND = 1000;
const HTTP_OK = 200;
const HOURS_PER_DAY = 24;
const MIN_SEARCH_QUERY_CHARS = 3;
const ANALYTICS_MONTH_DAYS = 30;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_CONFLICT = 409;
const HTTP_INTERNAL_SERVER_ERROR = 500;
const SECONDS_PER_MINUTE = 60;
const ANALYTICS_WEEK_DAYS = 7;
const ANALYTICS_QUARTER_DAYS = 90;


const NATIVE_SESSION_BACKENDS = new Set(["claude-code", "codex", "gemini", "amp", "antigravity"]);

import { errorMessage } from "../../errors.mjs";
import { isNonArrayObject as isRecord } from "../../valuePredicates.mjs";
import { isWithin } from "../pathContainment.mjs";

function sessionReferenceResolver({ catalog, sessionReferences, sessionReferenceFor, sqlite }) {
  const validateReference = sessionReferences?.validate;
  if (typeof validateReference !== "function" && (sqlite || typeof sessionReferenceFor !== "function")) throw new TypeError("a session reference validator is required");
  return (session) => {
    const reference = !sqlite && typeof validateReference !== "function"
      ? sessionReferenceFor(session)
      : sessionReferences.validate(sqlite
        ? { backend: "sqlite", id: session.id, storagePath: catalog.storagePath }
        : { backend: "jsonl", id: session.id, storagePath: session.path });
    if (!reference || typeof reference !== "object") throw new TypeError("session reference resolver returned an invalid reference");
    return reference;
  };
}

async function sessionFamilySummaries({ catalog, rootReference, includeAncestors, sqlite }) {
  if (sqlite) return typeof catalog.family === "function" ? await catalog.family(rootReference.id, { includeAncestors }) : await catalog.list({});
  const locations = new Set([dirname(rootReference.storagePath)]);
  for (const folder of await catalog.folders?.() ?? []) {
    const location = typeof folder === "string" ? folder : folder?.dir;
    if (location) locations.add(location);
  }
  return (await Promise.all([...locations].map((location) => catalog.list({ location })))).flat();
}

function sessionFamilyIndexes(summaries, { identity, parentIdentity }) {
  const unique = new Map(summaries.filter((session) => identity(session)).map((session) => [identity(session), session]));
  const children = new Map();
  for (const session of unique.values()) {
    const parent = parentIdentity(session);
    if (!parent) continue;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(session);
  }
  return { unique, children };
}

function familyRootIdentity(rootIdentity, includeAncestors, { unique, parentIdentity }) {
  if (!includeAncestors) return rootIdentity;
  const seenAncestors = new Set();
  while (unique.has(rootIdentity) && parentIdentity(unique.get(rootIdentity)) && unique.has(parentIdentity(unique.get(rootIdentity))) && !seenAncestors.has(rootIdentity)) {
    seenAncestors.add(rootIdentity);
    rootIdentity = parentIdentity(unique.get(rootIdentity));
  }
  return rootIdentity;
}

function descendantReferences({ rootIdentity, rootReference, unique, children, identity, referenceFor }) {
  const familyRoot = unique.get(rootIdentity);
  const references = [familyRoot ? referenceFor(familyRoot) : rootReference];
  const pending = [rootIdentity];
  const seen = new Set(pending);
  while (pending.length) {
    for (const child of children.get(pending.shift()) ?? []) {
      const childIdentity = identity(child);
      if (seen.has(childIdentity)) continue;
      seen.add(childIdentity);
      pending.push(childIdentity);
      references.push(referenceFor(child));
    }
  }
  return references;
}

/** Resolve a root session and every transitive child across catalog folders. */
export async function collectSessionFamilyReferences({ catalog, sessionReferences, sessionReferenceFor = null, rootReference, includeAncestors = false }) {
  if (NATIVE_SESSION_BACKENDS.has(rootReference.backend)) return [sessionReferences.validate(rootReference)];
  const sqlite = catalog.backend === "sqlite";
  const referenceFor = sessionReferenceResolver({ catalog, sessionReferences, sessionReferenceFor, sqlite });
  const summaries = await sessionFamilySummaries({ catalog, rootReference, includeAncestors, sqlite });
  const identity = (session) => sqlite ? session.id : session.path;
  const parentIdentity = (session) => sqlite ? session.parentSessionId : session.parentSession;
  const indexes = sessionFamilyIndexes(summaries, { identity, parentIdentity });
  const initialRoot = sqlite ? rootReference.id : rootReference.storagePath;
  const rootIdentity = familyRootIdentity(initialRoot, includeAncestors, { unique: indexes.unique, parentIdentity });
  return descendantReferences({ rootIdentity, rootReference, ...indexes, identity, referenceFor });
}

/** Persist one archive state across a root session and every transitive child. */
export async function setSessionFamilyArchived({ state, catalog, sessionReferenceFor = null, rootReference, archived, includeAncestors = false, now = () => Date.now() }) {
  const references = await collectSessionFamilyReferences({ catalog, sessionReferences: state.sessionReferences, sessionReferenceFor, rootReference, includeAncestors });
  const repository = state.appStore?.repositories?.sessions;
  const updateFamily = async (repositories) => {
    for (const reference of references) {
      const owner = await repositories.sessions.find({
        backend: reference.backend,
        sessionId: reference.id,
        storagePath: reference.storagePath ?? null,
      }) ?? await repositories.sessions.upsert({
        backend: reference.backend,
        sessionId: reference.id,
        storagePath: reference.storagePath ?? null,
        createdAt: new Date(now()).toISOString(),
      });
      await repositories.sessions.setArchived(owner.id, archived);
    }
  };
  if (typeof state.appStore?.transaction === "function") await state.appStore.transaction(updateFamily);
  else await updateFamily({ sessions: repository });
  return references;
}

/** Stop the runner for a parent session and every transitive child. */
export async function stopSessionFamilyRunners({ state, catalog, rootRunner, stopRunner }) {
  const references = rootRunner.sessionRef ? await collectSessionFamilyReferences({
    catalog,
    sessionReferences: state.sessionReferences,
    rootReference: rootRunner.sessionRef,
  }) : [];
  const matching = references.length ? [...state.runners.values()].filter((runner) => runner.sessionRef
    ? references.some((reference) => state.sessionReferences.equals(runner.sessionRef, reference))
    : references.some((reference) => reference.backend === "jsonl" && runner.sessionFile === reference.storagePath)) : [rootRunner];
  for (const runner of matching) await stopRunner(runner);
  return matching;
}

/** Build saved-session and history routes from the configured catalog. */
export function createSessionRoutes({
  state,
  requestContext,
  sessions,
  runners,
  resources,
  sessionOperations = null,
  deleteOwnedSession = null,
  resolvePath = resolve,
  unlinkFile = unlinkSync,
  now = () => Date.now(),
  logger = console,
}) {
  if (!state || typeof state !== "object" || !(state.runners instanceof Map)
    || !state.sessionReferences || typeof state.sessionReferences.serialize !== "function"
    || typeof state.sessionReferences.equals !== "function") {
    throw new TypeError("state with runners and session reference operations is required");
  }
  if (!requestContext || typeof requestContext.json !== "function") throw new TypeError("requestContext.json must be a function");
  if (!sessions?.catalog || !["jsonl", "sqlite"].includes(sessions.catalog.backend)) {
    throw new TypeError("a JSONL or SQLite session catalog is required");
  }
  const requiredFunctions = {
    stopRunner: runners?.stopRunner,
    runnersChanged: runners?.runnersChanged,
    resolvePath,
    now,
  };
  const missingFunction = Object.entries(requiredFunctions).find(([, value]) => typeof value !== "function");
  if (missingFunction) throw new TypeError(`${missingFunction[0]} must be a function`);
  if (typeof resources?.closeSessionHublots !== "function" && typeof resources?.closeTunnel !== "function") {
    throw new TypeError("closeTunnel must be a function when closeSessionHublots is unavailable");
  }

  const { json, readJsonBody } = requestContext;
  const { catalog, sessionReferenceFor, sessionTargetFromSearch, readSessionHeaderInfo } = sessions;
  const { stopRunner, runnersChanged } = runners;
  const {
    closeTunnel,
    closeSessionHublots = null,
    listTunnels = () => [],
    stopSessionRoutines = () => [],
    deleteSessionRoutines = resources.releaseSessionRoutines ?? (() => []),
  } = resources;
  const sqlite = catalog.backend === "sqlite";

  function referenceFor(session) {
    if (NATIVE_SESSION_BACKENDS.has(session.sessionRef?.backend)) return state.sessionReferences.validate(session.sessionRef);
    return sqlite
      ? state.sessionReferences.validate({ backend: "sqlite", id: session.id, storagePath: catalog.storagePath })
      : sessionReferenceFor(session);
  }

  async function decorate(session, byLegacyPath = new Map()) {
    const sessionRef = referenceFor(session);
    let parentSessionKey = null;
    if (sqlite && session.parentSessionId) {
      parentSessionKey = state.sessionReferences.serialize(referenceFor({ id: session.parentSessionId }));
    } else if (session.parentSession && byLegacyPath.has(session.parentSession)) {
      parentSessionKey = state.sessionReferences.serialize(referenceFor(byLegacyPath.get(session.parentSession)));
    }
    const owner = await state.appStore?.repositories?.sessions?.upsert({
      backend: sessionRef.backend,
      sessionId: sessionRef.id,
      storagePath: sessionRef.storagePath ?? null,
      createdAt: session.createdAt ?? new Date(now()).toISOString(),
    });
    return {
      ...session,
      ...(!session.createdAt && owner?.created_at ? { createdAt: owner.created_at } : {}),
      archived: Boolean(owner?.archived),
      path: sqlite ? null : session.path,
      parentSession: sqlite ? null : (session.parentSession ?? null),
      parentSessionKey,
      sessionRef,
      sessionKey: state.sessionReferences.serialize(sessionRef),
    };
  }

  function requestedIdentity(url) {
    const key = url.searchParams.get("key");
    if (key) {
      try {
        const reference = state.sessionReferences.parse(key);
        return reference.backend === catalog.backend ? (sqlite ? reference.id : reference.storagePath) : null;
      } catch { return null; }
    }
    return sqlite ? null : sessionTargetFromSearch(url);
  }

  function parseTranscriptPage(url) {
    const rawLimit = url.searchParams.get("limit");
    const rawBefore = url.searchParams.get("before");
    const limit = rawLimit === null ? null : Number(rawLimit);
    const before = rawBefore === null ? null : Number(rawBefore);
    const invalid = (limit !== null && (!Number.isInteger(limit) || limit < 1 || limit > HTTP_OK))
      || (before !== null && (!Number.isInteger(before) || before < 0));
    return invalid ? null : { limit, before };
  }

  function attachNativeCodexState(transcript, saved) {
    if (saved?.harness !== "codex") return;
    const home = state.config?.CODEX_HOME || process.env.CODEX_HOME || resolve(homedir(), ".codex");
    const nativeState = createCodexSessionStateReader(home, transcript.sessionId)();
    const lastAssistant = transcript.messages?.findLast((message) => message.role === "assistant" && message.model && message.model !== "openai");
    transcript.state = nativeState ?? { model: lastAssistant ? { provider: lastAssistant.provider || "openai", id: lastAssistant.model } : null };
  }

  function transcriptPage(messages, { limit, before }) {
    if (limit === null) return { messages, page: null };
    const end = before === null ? messages.length : Math.min(before, messages.length);
    let start = Math.max(0, end - limit);
    const targetStart = start;
    while (start > 0 && messages[start]?.role !== "user") start--;
    if (start > 0 && start < targetStart) {
      start--;
      while (start > 0 && messages[start]?.role !== "user") start--;
    }
    return { messages: messages.slice(start, end), page: { before: start > 0 ? start : null, hasMore: start > 0, total: messages.length } };
  }

  function sessionSearchIdentity(url) {
    const key = url.searchParams.get("key");
    if (!key) return null;
    try {
      const reference = state.sessionReferences.parse(key);
      return reference.backend === catalog.backend ? (sqlite ? reference.id : reference.storagePath) : null;
    } catch { return null; }
  }

  function validJsonlSessionPath(path) {
    return Boolean(path) && isWithin(path, catalog.root) && path !== catalog.root && path.endsWith(".jsonl");
  }

  function validateSessionSearchScope({ path, sessionIdentity }) {
    if (sqlite) return sessionIdentity ? null : "scope=session requires a session key";
    return validJsonlSessionPath(path) ? null : "scope=session requires a session file path";
  }

  function validateSearchRequest({ query, scope, path, sessionIdentity }) {
    if (query.length < MIN_SEARCH_QUERY_CHARS) return "query must be at least 3 characters";
    if (!["session", "folder", "all"].includes(scope)) return `invalid scope: ${scope}`;
    if (scope === "session") return validateSessionSearchScope({ path, sessionIdentity });
    if (scope === "folder" && !sqlite && path && !isWithin(path, catalog.root)) return "folder must be under the sessions root";
    return null;
  }

  function decorateSearchResults(result) {
    result.results = result.results.map((hit) => {
      const source = sqlite ? { id: hit.sessionId } : { id: hit.sessionId, path: hit.sessionPath };
      const sessionRef = referenceFor(source);
      return { ...hit, sessionRef, sessionKey: state.sessionReferences.serialize(sessionRef) };
    });
    return result;
  }

  return {
    "GET /analytics/usage": async (_req, res, url) => {
      if (!sqlite || typeof catalog.usageAnalytics !== "function") {
        json(res, HTTP_BAD_REQUEST, { error: "usage analytics requires the SQLite session backend" });
        return;
      }
      const range = url.searchParams.get("range") || "7d";
      const bucket = url.searchParams.get("bucket") || "day";
      const durations = { "24h": HOURS_PER_DAY * SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND, "7d": ANALYTICS_WEEK_DAYS * HOURS_PER_DAY * SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND, "30d": ANALYTICS_MONTH_DAYS * HOURS_PER_DAY * SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND, "90d": ANALYTICS_QUARTER_DAYS * HOURS_PER_DAY * SECONDS_PER_MINUTE * SECONDS_PER_MINUTE * MILLISECONDS_PER_SECOND, all: null };
      if (!(range in durations) || !["hour", "day"].includes(bucket)) {
        json(res, HTTP_BAD_REQUEST, { error: "invalid analytics range or bucket" });
        return;
      }
      const generatedAtMs = now();
      const since = durations[range] == null ? null : new Date(generatedAtMs - durations[range]).toISOString();
      try {
        json(res, HTTP_OK, { range, since, generatedAt: new Date(generatedAtMs).toISOString(), ...await catalog.usageAnalytics({ bucket, since }) });
      } catch (error) {
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `cannot aggregate usage: ${errorMessage(error)}` });
      }
    },

    "GET /sessions": async (_req, res, url) => {
      let cwd;
      let location;
      const all = sqlite && url.searchParams.get("all") === "1";
      if (all) {
        // Leaving cwd unset asks the SQLite catalog for every known session.
      } else if (url.searchParams.get("path")) {
        const requested = resolvePath(String(url.searchParams.get("path")));
        if (sqlite) cwd = requested;
        else {
          location = requested;
          if (!isWithin(location, catalog.root)) {
            json(res, HTTP_BAD_REQUEST, { error: "folder must be under the sessions root" });
            return;
          }
        }
      } else if (url.searchParams.get("dir")) cwd = resolvePath(String(url.searchParams.get("dir")));
      else cwd = state.currentDir;

      try {
        const catalogSummaries = await catalog.list({ cwd, location });
        if (!Array.isArray(catalogSummaries)) throw new TypeError("session catalog returned an invalid list");
        const summaries = [...catalogSummaries];
        const seenNative = new Set();
        for (const runner of state.runners.values()) {
          if (!NATIVE_SESSION_BACKENDS.has(runner.sessionRef?.backend) || (cwd && runner.dir !== cwd)) continue;
          const key = state.sessionReferences.serialize(runner.sessionRef);
          if (seenNative.has(key)) continue;
          seenNative.add(key);
          summaries.push({ id: runner.sessionRef.id, sessionRef: runner.sessionRef, name: runner.sessionName, cwd: runner.dir, harness: runner.harness });
        }
        const byLegacyPath = new Map(summaries.filter((session) => session.path).map((session) => [session.path, session]));
        const live = [...state.runners.values()];
        const result = await Promise.all(summaries.map(async (summary) => {
          const session = await decorate(summary, byLegacyPath);
          const runner = live.find((candidate) => candidate.sessionRef
            ? state.sessionReferences.equals(candidate.sessionRef, session.sessionRef)
            : candidate.sessionFile === session.path);
          return { ...session, runnerId: runner?.id ?? null, alive: !!runner?.proc, busy: !!runner?.busy };
        }));
        json(res, HTTP_OK, { sessions: result });
      } catch (error) {
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `failed to list sessions: ${errorMessage(error)}` });
      }
    },

    "POST /session/archive": async (req, res) => {
      if (!readJsonBody) {
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: "request body reader unavailable" });
        return;
      }
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      if (!isRecord(body)) {
        json(res, HTTP_BAD_REQUEST, { error: "request body must be a JSON object" });
        return;
      }
      let reference;
      try { reference = state.sessionReferences.parse(String(body.sessionKey ?? "")); }
      catch {
        json(res, HTTP_BAD_REQUEST, { error: "invalid session reference" });
        return;
      }
      if (reference.backend !== catalog.backend && !NATIVE_SESSION_BACKENDS.has(reference.backend)) {
        json(res, HTTP_BAD_REQUEST, { error: "session backend does not match the configured store" });
        return;
      }
      const repository = state.appStore?.repositories?.sessions;
      const owner = await repository?.find({
        backend: reference.backend,
        sessionId: reference.id,
        storagePath: reference.storagePath ?? null,
      });
      if (!owner) {
        json(res, HTTP_NOT_FOUND, { error: "session is not registered" });
        return;
      }
      const archived = body.archived !== false;
      try {
        const references = await setSessionFamilyArchived({ state, catalog, sessionReferenceFor, rootReference: reference, archived, includeAncestors: !archived, now });
        if (archived) {
          for (const runner of state.runners.values()) {
            const belongsToFamily = runner.sessionRef
              ? references.some((familyReference) => state.sessionReferences.equals(runner.sessionRef, familyReference))
              : references.some((familyReference) => familyReference.backend === "jsonl" && runner.sessionFile === familyReference.storagePath);
            if (belongsToFamily && runner.proc) await stopRunner(runner);
          }
        }
        json(res, HTTP_OK, { sessionKey: body.sessionKey, archived });
      } catch (error) {
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `failed to update session archive state: ${errorMessage(error)}` });
      }
    },

    "DELETE /session": async (_req, res, url) => {
      let reference = null;
      const key = url.searchParams.get("key");
      if (key) {
        try {
          const parsed = state.sessionReferences.parse(key);
          if (parsed.backend === catalog.backend) reference = parsed;
        } catch {}
      } else if (!sqlite) {
        const target = sessionTargetFromSearch(url);
        if (target) {
          try {
            const id = readSessionHeaderInfo(target)?.id;
            if (id) reference = referenceFor({ id, path: target });
          } catch {}
        }
      }
      if (!reference) {
        json(res, HTTP_BAD_REQUEST, { error: `not a session reference: ${url.searchParams.get("path") ?? key}` });
        return;
      }
      const operations = sessionOperations ?? {
        capabilities: { delete: { jsonl: true, sqlite: false } },
        async deleteSession(sessionRef) {
          unlinkFile(sessionRef.storagePath);
          return { deleted: sessionRef.storagePath };
        },
      };
      if (!operations?.capabilities?.delete?.[reference.backend]) {
        json(res, HTTP_CONFLICT, { error: `${reference.backend} session deletion is not supported by the configured pi` });
        return;
      }
      const matchingRunners = [...state.runners.values()].filter((runner) => runner.sessionRef
        ? state.sessionReferences.equals(runner.sessionRef, reference)
        : reference.backend === "jsonl" && runner.sessionFile === reference.storagePath);
      const workflow = deleteOwnedSession ?? (async (steps) => {
        const stoppedRunners = await steps.stopRunners();
        const stoppedRoutines = await steps.stopRoutines();
        const agentResult = await steps.deleteAgentSession();
        await steps.removeRuntime(stoppedRunners);
        await steps.broadcast();
        const closedHublots = await steps.closeHublots();
        const deletedRoutines = await steps.deleteRoutines();
        return { agentResult, closedHublots, stoppedRoutines, deletedRoutines };
      });
      try {
        const outcome = await workflow({
          reference,
          stopRunners: async () => { for (const runner of matchingRunners) await stopRunner(runner); return matchingRunners; },
          closeHublots: async () => {
            if (closeSessionHublots) return closeSessionHublots(state, reference.id);
            const closed = [];
            for (const tunnel of await listTunnels(state)) {
              if (tunnel.sessionId !== reference.id) continue;
              await closeTunnel(state, tunnel.id);
              closed.push(tunnel.port);
              logger.log(`[oyster] closed hublot :${tunnel.port} (session ${reference.id} deleted)`);
            }
            return closed;
          },
          stopRoutines: () => stopSessionRoutines(state, reference.id),
          deleteRoutines: () => deleteSessionRoutines(state, reference.id),
          deleteAgentSession: () => operations.deleteSession(reference),
          removeRuntime: async (stoppedRunners) => {
            for (const runner of stoppedRunners) {
              state.runners.delete(runner.id);
              if (state.defaultRunnerId === runner.id) {
                state.defaultRunnerId = null;
                await state.appSettings?.setDefaultRunnerId(null);
              }
            }
          },
          broadcast: () => runnersChanged(),
        });
        json(res, HTTP_OK, {
          deleted: outcome.agentResult.deleted,
          closedHublots: outcome.closedHublots,
          releasedRoutines: outcome.deletedRoutines,
        });
      } catch (error) {
        const status = error?.code === "capability_unavailable" ? HTTP_CONFLICT : HTTP_INTERNAL_SERVER_ERROR;
        json(res, status, { error: `failed to delete session: ${errorMessage(error)}` });
      }
    },

    "GET /session-by-id": async (_req, res, url) => {
      const id = String(url.searchParams.get("id") ?? "").trim();
      if (!id) { json(res, HTTP_BAD_REQUEST, { error: "id required" }); return; }
      try {
        const session = await catalog.findById(id);
        if (!session) { json(res, HTTP_NOT_FOUND, { error: `no session with id ${id}` }); return; }
        json(res, HTTP_OK, { session: await decorate(session) });
      } catch (error) {
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `failed to read session: ${errorMessage(error)}` });
      }
    },

    "GET /session-entries": async (_req, res, url) => {
      const identity = requestedIdentity(url);
      if (!identity) { json(res, HTTP_NOT_FOUND, { error: "session not found" }); return; }
      try { json(res, HTTP_OK, await catalog.entries(identity)); }
      catch (error) { json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `failed to parse session: ${errorMessage(error)}` }); }
    },

    "GET /session-messages": async (_req, res, url) => {
      const identity = requestedIdentity(url);
      if (!identity) { json(res, HTTP_NOT_FOUND, { error: "session not found" }); return; }
      const pageRequest = parseTranscriptPage(url);
      if (!pageRequest) { json(res, HTTP_BAD_REQUEST, { error: "invalid transcript page" }); return; }
      try {
        const transcript = await catalog.messages(identity);
        const saved = transcript.sessionId ? await catalog.findById?.(transcript.sessionId) : null;
        attachNativeCodexState(transcript, saved);
        if (pageRequest.limit === null) { json(res, HTTP_OK, transcript); return; }
        const page = transcriptPage(Array.isArray(transcript.messages) ? transcript.messages : [], pageRequest);
        json(res, HTTP_OK, { ...transcript, messages: page.messages, page: page.page });
      } catch (error) { json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `failed to parse session: ${errorMessage(error)}` }); }
    },

    "GET /session-folders": async (_req, res, url) => {
      const forDir = url.searchParams.get("dir") ? resolvePath(String(url.searchParams.get("dir"))) : state.currentDir;
      try {
        json(res, HTTP_OK, { folders: await catalog.folders(), current: catalog.locationForCwd(forDir) });
      } catch (error) {
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `failed to list session folders: ${errorMessage(error)}` });
      }
    },

    "GET /search": async (_req, res, url) => {
      const query = String(url.searchParams.get("q") ?? "").trim();
      const scope = String(url.searchParams.get("scope") ?? "folder");
      const rawPath = url.searchParams.get("path");
      let path = rawPath ? resolvePath(String(rawPath)) : null;
      const sessionIdentity = sessionSearchIdentity(url);
      if (scope === "session" && !sqlite && sessionIdentity) path = sessionIdentity;
      const error = validateSearchRequest({ query, scope, path, sessionIdentity });
      if (error) { json(res, HTTP_BAD_REQUEST, { error }); return; }
      try {
        const result = decorateSearchResults(await catalog.search(sqlite ? {
          q: query,
          scope,
          path: scope === "session" ? sessionIdentity : path,
          cwd: path ?? state.currentDir,
          includeTools: url.searchParams.get("tools") === "1",
        } : {
          q: query,
          scope,
          path,
          includeTools: url.searchParams.get("tools") === "1",
          defaultDir: catalog.locationForCwd(state.currentDir),
        }));
        json(res, HTTP_OK, { q: query, scope, ...result });
      } catch (searchError) {
        json(res, HTTP_INTERNAL_SERVER_ERROR, { error: `search failed: ${errorMessage(searchError)}` });
      }
    },
  };
}
