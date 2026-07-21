async function jsonRequest(fetchImpl, url, body) {
  const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
  return data;
}

export function createCheckpoint(fetchImpl, runner, model) {
  return jsonRequest(fetchImpl, `/checkpoint?runner=${encodeURIComponent(runner ?? "")}`, { model });
}

export function rollbackCheckpoint(fetchImpl, { sessionId, hash, model }) {
  return jsonRequest(fetchImpl, "/rollback", { sessionId, hash, model });
}
