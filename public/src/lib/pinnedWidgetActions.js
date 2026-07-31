async function jsonResponse(response, fallback) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `${fallback} (${response.status})`);
  return data;
}

export async function listPinnedWidgets(fetchImpl, { sessionId = null, scope = "session" } = {}) {
  const query = new URLSearchParams({ scope });
  if (sessionId) query.set("sessionId", sessionId);
  return jsonResponse(await fetchImpl(`/pinned-widgets?${query}`), "cannot list pinned widgets");
}

export async function pinPath(fetchImpl, { path, label = null, sessionId = null, scope = "session", groupId = null }) {
  return jsonResponse(await fetchImpl("/pinned-widgets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, label, sessionId, scope, groupId }),
  }), "cannot pin artifact");
}

export async function pinLink(fetchImpl, { url, label = null, sessionId = null, scope = "session", groupId = null }) {
  return jsonResponse(await fetchImpl("/pinned-widgets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, label, sessionId, scope, groupId }),
  }), "cannot pin link");
}

export async function unpinWidget(fetchImpl, id) {
  return jsonResponse(await fetchImpl(`/pinned-widgets?id=${encodeURIComponent(id)}`, { method: "DELETE" }), "cannot unpin widget");
}

export async function updatePinnedWidget(fetchImpl, patch) {
  return jsonResponse(await fetchImpl("/pinned-widgets", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(patch),
  }), "cannot update pinned widget");
}

export async function createPinnedWidgetGroup(fetchImpl, { name, sessionId = null, scope = "session" }) {
  return jsonResponse(await fetchImpl("/pinned-widget-groups", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, sessionId, scope }),
  }), "cannot create widget group");
}

export async function updatePinnedWidgetGroup(fetchImpl, { id, name, scope, sessionId = null }) {
  return jsonResponse(await fetchImpl("/pinned-widget-groups", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, name, scope, sessionId }),
  }), "cannot update widget group");
}

export async function deletePinnedWidgetGroup(fetchImpl, id, { ungroup = false, deleteWidgets = false } = {}) {
  const query = new URLSearchParams({ id });
  if (ungroup) query.set("ungroup", "1");
  if (deleteWidgets) query.set("deleteWidgets", "1");
  return jsonResponse(await fetchImpl(`/pinned-widget-groups?${query}`, { method: "DELETE" }), "cannot delete widget group");
}

export async function readPinnedTextArtifact(fetchImpl, id) {
  return jsonResponse(await fetchImpl(`/pinned-widget-content?id=${encodeURIComponent(id)}`), "cannot display text artifact");
}

export async function readPinnedMonitorContent(fetchImpl, id) {
  return jsonResponse(await fetchImpl(`/pinned-widget-monitor-content?id=${encodeURIComponent(id)}`), "cannot refresh monitoring widget");
}
