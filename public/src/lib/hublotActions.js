export async function listHublots(fetchImpl, visible) {
  const res = await fetchImpl("/tunnels");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `tunnels failed (${res.status})`);
  return (data.tunnels ?? []).filter(visible);
}

export async function createHublot(fetchImpl, { label, sessionId, brief }) {
  const res = await fetchImpl("/tunnels", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label, sessionId, brief }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `tunnel create failed (${res.status})`);
  return data;
}

export async function removeHublot(fetchImpl, id) {
  const res = await fetchImpl(`/tunnels?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `tunnel delete failed (${res.status})`);
  }
}
