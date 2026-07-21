export async function listRoutines(fetchImpl) {
  const res = await fetchImpl("/routines");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `routines failed (${res.status})`);
  return data.routines ?? [];
}

export async function runRoutine(fetchImpl, { name, action, sessionId }) {
  const res = await fetchImpl("/routines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, action, sessionId }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `routine ${action} failed (${res.status})`);
  return data;
}
