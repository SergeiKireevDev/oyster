import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { promisify } from "node:util";

const IMAGE_MIME = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"],
  [".gif", "image/gif"], [".webp", "image/webp"], [".avif", "image/avif"],
  [".svg", "image/svg+xml"],
]);
const VIDEO_MIME = new Map([
  [".mp4", "video/mp4"], [".webm", "video/webm"], [".ogv", "video/ogg"],
  [".mov", "video/quicktime"], [".m4v", "video/x-m4v"],
  [".avi", "video/x-msvideo"], [".mkv", "video/x-matroska"],
]);
const BROWSER_VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/ogg"]);
const execFileAsync = promisify(execFile);
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdown", ".mkd"]);
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const INLINE_KINDS = new Set(["image", "video"]);

function id(prefix) {
  return `${prefix}-${randomBytes(9).toString("base64url")}`;
}

export function classifyPinnedPath(path, stat = statSync(path)) {
  if (stat.isDirectory()) return { kind: "directory", mimeType: null };
  const extension = extname(path).toLowerCase();
  if (IMAGE_MIME.has(extension)) return { kind: "image", mimeType: IMAGE_MIME.get(extension) };
  if (VIDEO_MIME.has(extension)) return { kind: "video", mimeType: VIDEO_MIME.get(extension) };
  if (MARKDOWN_EXTENSIONS.has(extension)) return { kind: "markdown", mimeType: "text/markdown; charset=utf-8" };
  if (HTML_EXTENSIONS.has(extension)) return { kind: "file", mimeType: "text/html; charset=utf-8" };
  return { kind: "file", mimeType: "application/octet-stream" };
}

function scopeIdentity(body, ensureSessionOwner) {
  const requestedScope = body?.scope === "workspace" ? "workspace" : "session";
  const sessionId = body?.sessionId ? String(body.sessionId).slice(0, 100) : null;
  if (requestedScope === "workspace" || !sessionId) return { scope: "workspace", ownerId: null, sessionId: null };
  const owner = ensureSessionOwner(sessionId);
  if (!owner) throw Object.assign(new Error("unknown session for pinned widget"), { statusCode: 404 });
  return { scope: "session", ownerId: owner.id, sessionId };
}

function rowVisible(row, sessionId, scope) {
  if (scope === "all") return true;
  if (scope === "workspace") return row.scope === "workspace";
  return row.scope === "workspace" || (!!sessionId && row.session_id === sessionId);
}

function pathState(row, resolveSafePath) {
  const target = row.target ? resolveSafePath(resolve(row.target)) : null;
  if (!target) return { availability: "missing", path: row.target };
  try {
    const stat = statSync(target);
    const expectedDirectory = row.kind === "directory";
    if (expectedDirectory !== stat.isDirectory()) return { availability: "missing", path: target };
    return { availability: "ready", path: target, size: stat.size, mtimeMs: Math.trunc(stat.mtimeMs) };
  } catch {
    return { availability: "missing", path: target };
  }
}

export function pinnedWidgetDto(state, row, { resolveSafePath, activeTunnels = null } = {}) {
  const base = {
    id: row.id,
    kind: row.kind,
    label: row.label,
    scope: row.scope,
    sessionId: row.session_id ?? null,
    groupId: row.group_id ?? null,
    position: Number(row.position),
    mimeType: row.mime_type ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.kind === "live_interface") {
    const hublot = state.appStore.repositories.hublots.find(row.hublot_id);
    const tunnel = activeTunnels?.find((item) => item.id === row.hublot_id) ?? null;
    const status = tunnel?.status ?? hublot?.status ?? "closed";
    return {
      ...base,
      hublotId: row.hublot_id,
      availability: tunnel?.url ? "ready" : ["opening", "recovering"].includes(status) ? "opening" : status === "failed" ? "error" : "closed",
      status,
      url: tunnel?.url ?? null,
      port: hublot?.port ?? null,
      error: hublot?.last_error ?? null,
    };
  }
  if (["image", "video", "markdown", "file", "directory"].includes(row.kind)) {
    return { ...base, ...pathState(row, resolveSafePath) };
  }
  if (row.kind === "builtin") return { ...base, availability: "ready", builtin: row.target };
  return { ...base, availability: "ready", url: row.target };
}

export function listPinnedWidgets(state, { sessionId = null, scope = "session", resolveSafePath, listTunnels = () => [] } = {}) {
  const repository = state.appStore.repositories.pinnedWidgets;
  const activeTunnels = listTunnels(state);
  return {
    widgets: repository.list()
      .filter((row) => rowVisible(row, sessionId, scope))
      .map((row) => pinnedWidgetDto(state, row, { resolveSafePath, activeTunnels })),
    groups: repository.listGroups()
      .filter((row) => rowVisible(row, sessionId, scope))
      .map((row) => ({
        id: row.id, name: row.name, scope: row.scope, sessionId: row.session_id ?? null,
        position: Number(row.position), createdAt: row.created_at, updatedAt: row.updated_at,
      })),
  };
}

export function ensurePinnedHublot(state, hublot) {
  if (!hublot) return null;
  const repository = state.appStore.repositories.pinnedWidgets;
  const existing = repository.list().find((row) => row.hublot_id === hublot.id);
  const scope = hublot.owner_id == null ? "workspace" : "session";
  const now = new Date().toISOString();
  if (existing) {
    if (existing.owner_id !== (hublot.owner_id ?? null) || existing.scope !== scope) {
      repository.update(existing.id, {
        owner_id: hublot.owner_id ?? null,
        scope,
        group_id: null,
        updated_at: now,
      });
    }
    return repository.find(existing.id);
  }
  return repository.create({
    id: `hublot:${hublot.id}`,
    ownerId: hublot.owner_id ?? null,
    scope,
    kind: "live_interface",
    label: String(hublot.label || "Live interface").trim().slice(0, 200),
    position: repository.nextPosition({ ownerId: hublot.owner_id ?? null, scope }),
    hublotId: hublot.id,
    createdAt: hublot.created_at ?? now,
    updatedAt: now,
  });
}

function normalizeLabel(value, fallback) {
  const label = String(value ?? fallback ?? "").trim().slice(0, 200);
  if (!label) throw Object.assign(new Error("widget label is required"), { statusCode: 400 });
  return label;
}

function assertGroup(repository, groupId, identity) {
  if (!groupId) return null;
  const group = repository.findGroup(groupId);
  if (!group) throw Object.assign(new Error("no such pinned widget group"), { statusCode: 404 });
  if (group.scope !== identity.scope || group.owner_id !== identity.ownerId) {
    throw Object.assign(new Error("widget and group scopes do not match"), { statusCode: 409 });
  }
  return group;
}

function normalizeContainer(repository, identity, groupId) {
  repository.list()
    .filter((item) => item.scope === identity.scope && item.owner_id === identity.ownerId && item.group_id === groupId)
    .sort((a, b) => Number(a.position) - Number(b.position) || a.id.localeCompare(b.id))
    .forEach((item, position) => repository.update(item.id, { position }));
}

function reorderWidget(state, row, { groupId, beforeId }, now) {
  const repository = state.appStore.repositories.pinnedWidgets;
  const identity = { scope: row.scope, ownerId: row.owner_id };
  const nextGroupId = groupId === undefined ? row.group_id : groupId || null;
  assertGroup(repository, nextGroupId, identity);
  const oldGroupId = row.group_id ?? null;
  if (beforeId === row.id && nextGroupId === oldGroupId) return row;
  const siblings = repository.list()
    .filter((item) => item.id !== row.id && item.scope === row.scope && item.owner_id === row.owner_id && item.group_id === nextGroupId)
    .sort((a, b) => Number(a.position) - Number(b.position) || a.id.localeCompare(b.id));
  let index = beforeId ? siblings.findIndex((item) => item.id === beforeId) : siblings.length;
  if (beforeId && index < 0) throw Object.assign(new Error("reorder target is not in the destination group"), { statusCode: 409 });
  siblings.splice(index, 0, row);
  state.appStore.transaction(() => {
    siblings.forEach((item, position) => repository.update(item.id, {
      position,
      ...(item.id === row.id ? { group_id: nextGroupId, updated_at: now } : {}),
    }));
    if (oldGroupId !== nextGroupId) normalizeContainer(repository, identity, oldGroupId);
  });
  return repository.find(row.id);
}

function sendError(json, res, error) {
  json(res, Number(error.statusCode) || (/constraint/i.test(error.message) ? 409 : 400), { error: error.message });
}

function parseRange(header, size) {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(String(header).trim());
  if (!match || (!match[1] && !match[2])) throw new Error("invalid byte range");
  let start;
  let end;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isInteger(suffix) || suffix <= 0) throw new Error("invalid byte range");
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= size) {
    throw new Error("range not satisfiable");
  }
  return { start, end: Math.min(end, size - 1) };
}

function mediaTarget(state, widgetId, resolveSafePath) {
  const row = state.appStore.repositories.pinnedWidgets.find(widgetId);
  if (!row) throw Object.assign(new Error("no such pinned widget"), { statusCode: 404 });
  if (!INLINE_KINDS.has(row.kind)) throw Object.assign(new Error("widget is not safe inline media"), { statusCode: 415 });
  const target = row.target ? resolveSafePath(resolve(row.target)) : null;
  if (!target) throw Object.assign(new Error("pinned media is unavailable"), { statusCode: 404 });
  const stat = statSync(target);
  const classification = classifyPinnedPath(target, stat);
  if (classification.kind !== row.kind || classification.mimeType !== row.mime_type) {
    throw Object.assign(new Error("pinned media type changed; re-pin it before display"), { statusCode: 415 });
  }
  return { row, target, stat, mimeType: classification.mimeType, displayName: basename(target) };
}

function htmlTarget(state, widgetId, resolveSafePath) {
  const row = state.appStore.repositories.pinnedWidgets.find(widgetId);
  if (!row) throw Object.assign(new Error("no such pinned widget"), { statusCode: 404 });
  const isHtml = row.kind === "file" && String(row.mime_type ?? "").startsWith("text/html");
  if (!isHtml) throw Object.assign(new Error("widget is not an HTML artifact"), { statusCode: 415 });
  const target = row.target ? resolveSafePath(resolve(row.target)) : null;
  if (!target) throw Object.assign(new Error("pinned HTML artifact is unavailable"), { statusCode: 404 });
  const stat = statSync(target);
  const classification = classifyPinnedPath(target, stat);
  if (classification.kind !== "file" || !String(classification.mimeType ?? "").startsWith("text/html")) {
    throw Object.assign(new Error("pinned HTML type changed; re-pin it before display"), { statusCode: 415 });
  }
  return { target, stat, mimeType: classification.mimeType };
}

/** Convert browser-incompatible video containers once, then serve the cached MP4 with range support. */
export async function preparePinnedVideo(state, media, {
  ffmpegBin = process.env.FFMPEG_BIN || "ffmpeg",
  cacheRoot = join(tmpdir(), "oyster-pinned-widget-media"),
  execFileImpl = execFileAsync,
} = {}) {
  if (media.row.kind !== "video" || BROWSER_VIDEO_MIME.has(media.mimeType)) return media;
  const fingerprint = createHash("sha256")
    .update(`${media.target}\0${media.stat.size}\0${Math.trunc(media.stat.mtimeMs)}`)
    .digest("hex");
  mkdirSync(cacheRoot, { recursive: true });
  const target = join(cacheRoot, `${fingerprint}.mp4`);
  const cached = () => existsSync(target) && statSync(target).size > 0;
  if (!cached()) {
    const pending = state.pinnedWidgetTranscodes?.get(fingerprint);
    if (pending) await pending;
    else {
      const temporary = `${target}.${process.pid}.${randomBytes(4).toString("hex")}.part`;
      const task = (async () => {
        try {
          await execFileImpl(ffmpegBin, [
            "-hide_banner", "-loglevel", "error", "-y", "-i", media.target,
            "-map", "0:v:0", "-map", "0:a:0?", "-c:v", "libx264", "-preset", "veryfast",
            "-pix_fmt", "yuv420p", "-c:a", "aac", "-movflags", "+faststart", "-f", "mp4", temporary,
          ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });
          if (!existsSync(temporary) || statSync(temporary).size === 0) throw new Error("video conversion produced no playable output");
          renameSync(temporary, target);
        } catch (error) {
          rmSync(temporary, { force: true });
          const unavailable = error?.code === "ENOENT"
            ? new Error("this video needs FFmpeg for browser playback, but FFmpeg is not installed")
            : new Error(`video conversion failed: ${String(error?.stderr || error?.message || error).trim().slice(0, 500)}`);
          unavailable.statusCode = 415;
          throw unavailable;
        }
      })();
      state.pinnedWidgetTranscodes?.set(fingerprint, task);
      try { await task; } finally { state.pinnedWidgetTranscodes?.delete(fingerprint); }
    }
  }
  if (!cached()) throw Object.assign(new Error("converted video is unavailable"), { statusCode: 415 });
  return {
    ...media,
    target,
    stat: statSync(target),
    mimeType: "video/mp4",
    displayName: `${basename(media.target, extname(media.target))}.mp4`,
  };
}

export function createPinnedWidgetRoutes({
  state, requestContext, ensureSessionOwner, listTunnels = () => [], prepareVideo = preparePinnedVideo,
}) {
  const { json, readJsonBody, resolveSafePath } = requestContext;
  const repository = state.appStore.repositories.pinnedWidgets;
  const emit = (type, value) => state.serverEvent?.({ type, ...value });
  const currentCollection = (body = {}) => listPinnedWidgets(state, {
    sessionId: body.sessionId ? String(body.sessionId) : null,
    scope: body.scope === "all" ? "all" : body.scope === "workspace" ? "workspace" : "session",
    resolveSafePath,
    listTunnels,
  });

  return {
    "GET /pinned-widgets": (_req, res, url) => {
      json(res, 200, listPinnedWidgets(state, {
        sessionId: url.searchParams.get("sessionId"),
        scope: ["all", "workspace"].includes(url.searchParams.get("scope")) ? url.searchParams.get("scope") : "session",
        resolveSafePath,
        listTunnels,
      }));
    },

    "POST /pinned-widgets": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      try {
        const identity = scopeIdentity(body, ensureSessionOwner);
        let kind;
        let target = null;
        let mimeType = null;
        let size = null;
        let mtimeMs = null;
        let hublotId = null;
        let fallbackLabel;
        if (body.path) {
          target = resolveSafePath(resolve(String(body.path)));
          if (!target) throw Object.assign(new Error("path is outside the allowed workspace roots"), { statusCode: 403 });
          const stat = statSync(target);
          ({ kind, mimeType } = classifyPinnedPath(target, stat));
          size = stat.size;
          mtimeMs = Math.trunc(stat.mtimeMs);
          fallbackLabel = basename(target);
        } else if (body.hublotId) {
          const hublot = state.appStore.repositories.hublots.find(String(body.hublotId));
          if (!hublot) throw Object.assign(new Error("no such live interface"), { statusCode: 404 });
          const pinned = ensurePinnedHublot(state, hublot);
          json(res, 200, { widget: pinnedWidgetDto(state, pinned, { resolveSafePath, activeTunnels: listTunnels(state) }), ...currentCollection(body) });
          return;
        } else if (body.url) {
          const url = new URL(String(body.url));
          if (url.protocol !== "https:") throw Object.assign(new Error("only https links can be pinned"), { statusCode: 400 });
          kind = "link";
          target = url.href;
          fallbackLabel = url.hostname;
        } else {
          throw Object.assign(new Error("path, hublotId, or https url is required"), { statusCode: 400 });
        }
        const duplicate = repository.list().find((item) => item.scope === identity.scope && item.owner_id === identity.ownerId && item.kind === kind && item.target === target);
        if (duplicate) {
          json(res, 200, { widget: pinnedWidgetDto(state, duplicate, { resolveSafePath, activeTunnels: listTunnels(state) }), ...currentCollection(body) });
          return;
        }
        const groupId = body.groupId ? String(body.groupId) : null;
        assertGroup(repository, groupId, identity);
        const now = new Date().toISOString();
        const widget = repository.create({
          id: id("widget"), ...identity, groupId, kind,
          label: normalizeLabel(body.label, fallbackLabel),
          position: repository.nextPosition({ ...identity, groupId }), target, mimeType,
          size, mtimeMs, createdAt: now,
        });
        const dto = pinnedWidgetDto(state, widget, { resolveSafePath, activeTunnels: listTunnels(state) });
        emit("pinned_widget_created", { widget: dto });
        json(res, 201, { widget: dto, ...currentCollection(body) });
      } catch (error) { sendError(json, res, error); }
    },

    "PATCH /pinned-widgets": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      try {
        const row = repository.find(String(body.id ?? ""));
        if (!row) throw Object.assign(new Error("no such pinned widget"), { statusCode: 404 });
        const now = new Date().toISOString();
        let updated = row;
        if (body.groupId !== undefined || body.beforeId !== undefined) {
          updated = reorderWidget(state, row, {
            groupId: body.groupId === undefined ? undefined : body.groupId ? String(body.groupId) : null,
            beforeId: body.beforeId ? String(body.beforeId) : null,
          }, now);
        }
        if (body.label !== undefined) {
          repository.update(row.id, { label: normalizeLabel(body.label), updated_at: now });
          updated = repository.find(row.id);
        }
        const dto = pinnedWidgetDto(state, updated, { resolveSafePath, activeTunnels: listTunnels(state) });
        emit("pinned_widget_updated", { widget: dto });
        json(res, 200, { widget: dto, ...currentCollection(body) });
      } catch (error) { sendError(json, res, error); }
    },

    "DELETE /pinned-widgets": (req, res, url) => {
      try {
        const widgetId = String(url.searchParams.get("id") ?? "");
        const row = repository.find(widgetId);
        if (!row) throw Object.assign(new Error("no such pinned widget"), { statusCode: 404 });
        if (row.kind === "builtin") throw Object.assign(new Error("built-in widgets cannot be unpinned"), { statusCode: 409 });
        repository.delete(widgetId);
        normalizeContainer(repository, { scope: row.scope, ownerId: row.owner_id }, row.group_id);
        emit("pinned_widget_deleted", { widgetId });
        json(res, 200, { unpinned: widgetId });
      } catch (error) { sendError(json, res, error); }
    },

    "POST /pinned-widget-groups": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      try {
        const identity = scopeIdentity(body, ensureSessionOwner);
        const now = new Date().toISOString();
        const group = repository.createGroup({
          id: id("group"), ...identity, name: normalizeLabel(body.name).slice(0, 80),
          position: repository.nextGroupPosition(identity), createdAt: now,
        });
        emit("pinned_widget_updated", { group });
        json(res, 201, { group, ...currentCollection(body) });
      } catch (error) { sendError(json, res, error); }
    },

    "PATCH /pinned-widget-groups": async (req, res) => {
      const body = await readJsonBody(req, res);
      if (body === undefined) return;
      try {
        const group = repository.findGroup(String(body.id ?? ""));
        if (!group) throw Object.assign(new Error("no such pinned widget group"), { statusCode: 404 });
        repository.updateGroup(group.id, { name: normalizeLabel(body.name).slice(0, 80), updated_at: new Date().toISOString() });
        const updated = repository.findGroup(group.id);
        emit("pinned_widget_updated", { group: updated });
        json(res, 200, { group: updated, ...currentCollection(body) });
      } catch (error) { sendError(json, res, error); }
    },

    "DELETE /pinned-widget-groups": (req, res, url) => {
      try {
        const groupId = String(url.searchParams.get("id") ?? "");
        const group = repository.findGroup(groupId);
        if (!group) throw Object.assign(new Error("no such pinned widget group"), { statusCode: 404 });
        const children = repository.list().filter((item) => item.group_id === groupId);
        const ungroup = url.searchParams.get("ungroup") === "1";
        const deleteWidgets = url.searchParams.get("deleteWidgets") === "1";
        if (children.length && !ungroup && !deleteWidgets) {
          throw Object.assign(new Error("group is not empty; request ungroup=1 to keep its widgets or deleteWidgets=1 to remove them"), { statusCode: 409 });
        }
        state.appStore.transaction(() => {
          children.forEach((item) => {
            if (deleteWidgets) repository.delete(item.id);
            else repository.update(item.id, { group_id: null, updated_at: new Date().toISOString() });
          });
          repository.deleteGroup(groupId);
          normalizeContainer(repository, { scope: group.scope, ownerId: group.owner_id }, null);
        });
        emit("pinned_widget_updated", { groupId, deleted: true, deletedWidgetIds: deleteWidgets ? children.map((item) => item.id) : [] });
        json(res, 200, { deleted: groupId, deletedWidgets: deleteWidgets ? children.map((item) => item.id) : [] });
      } catch (error) { sendError(json, res, error); }
    },

    "GET /pinned-widget-content": (_req, res, url) => {
      try {
        const row = repository.find(String(url.searchParams.get("id") ?? ""));
        if (!row) throw Object.assign(new Error("no such pinned widget"), { statusCode: 404 });
        if (row.kind !== "markdown") throw Object.assign(new Error("widget is not a readable text artifact"), { statusCode: 415 });
        const target = row.target ? resolveSafePath(resolve(row.target)) : null;
        if (!target) throw Object.assign(new Error("pinned text artifact is unavailable"), { statusCode: 404 });
        const stat = statSync(target);
        if (stat.size > 5 * 1024 * 1024) throw Object.assign(new Error("text artifact is too large to display"), { statusCode: 413 });
        json(res, 200, { id: row.id, path: target, content: readFileSync(target, "utf8") });
      } catch (error) { sendError(json, res, error); }
    },

    "GET /pinned-widget-html": (req, res, url) => {
      try {
        const { target, stat, mimeType } = htmlTarget(state, String(url.searchParams.get("id") ?? ""), resolveSafePath);
        res.writeHead(200, {
          "content-type": mimeType,
          "content-length": stat.size,
          "cache-control": "private, no-cache",
          "content-security-policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; form-action 'none'; base-uri 'none'",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        });
        if (stat.size === 0) { res.end(); return; }
        const stream = createReadStream(target);
        const destroy = () => stream.destroy();
        req.once("aborted", destroy);
        res.once("close", destroy);
        stream.once("error", () => { if (!res.writableEnded) res.destroy(); });
        stream.pipe(res);
      } catch (error) { sendError(json, res, error); }
    },

    "HEAD /pinned-widget-media": async (req, res, url) => {
      try {
        const { stat, mimeType } = await prepareVideo(state, mediaTarget(state, String(url.searchParams.get("id") ?? ""), resolveSafePath));
        res.writeHead(200, {
          "content-type": mimeType, "content-length": stat.size, "accept-ranges": "bytes",
          "cache-control": "private, no-cache", "x-content-type-options": "nosniff",
        });
        res.end();
      } catch (error) { res.writeHead(Number(error.statusCode) || 404); res.end(); }
    },

    "GET /pinned-widget-media": async (req, res, url) => {
      try {
        const { target, stat, mimeType, displayName } = await prepareVideo(state, mediaTarget(state, String(url.searchParams.get("id") ?? ""), resolveSafePath));
        const etag = `W/\"${stat.size}-${Math.trunc(stat.mtimeMs)}\"`;
        if (!req.headers.range && req.headers["if-none-match"] === etag) {
          res.writeHead(304, { etag, "cache-control": "private, no-cache" });
          res.end();
          return;
        }
        let range = null;
        try { range = parseRange(req.headers.range, stat.size); }
        catch {
          res.writeHead(416, { "content-range": `bytes */${stat.size}`, "accept-ranges": "bytes" });
          res.end();
          return;
        }
        const start = range?.start ?? 0;
        const end = range?.end ?? Math.max(0, stat.size - 1);
        const headers = {
          "content-type": mimeType,
          "content-length": stat.size === 0 ? 0 : end - start + 1,
          "accept-ranges": "bytes",
          "cache-control": "private, no-cache",
          "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(displayName)}`,
          "content-security-policy": "default-src 'none'; sandbox",
          "x-content-type-options": "nosniff",
          etag,
        };
        if (range) headers["content-range"] = `bytes ${start}-${end}/${stat.size}`;
        res.writeHead(range ? 206 : 200, headers);
        if (stat.size === 0) { res.end(); return; }
        const stream = createReadStream(target, { start, end });
        const destroy = () => stream.destroy();
        req.once("aborted", destroy);
        res.once("close", destroy);
        stream.once("error", () => { if (!res.writableEnded) res.destroy(); });
        stream.pipe(res);
      } catch (error) { sendError(json, res, error); }
    },
  };
}
