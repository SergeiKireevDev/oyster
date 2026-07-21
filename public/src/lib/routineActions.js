export function routineVisible(routine, scopeAll, sessionId) {
  return scopeAll || !routine.sessionId || routine.sessionId === sessionId;
}

export async function listRoutines(fetchImpl) {
  const res = await fetchImpl("/routines");
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `routines failed (${res.status})`);
  return data.routines ?? [];
}

export async function generateRoutine(fetchImpl, { brief, sessionId }) {
  const res = await fetchImpl("/routines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "generate", brief, sessionId }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `routine generation failed (${res.status})`);
  return data;
}

export async function runRoutine(fetchImpl, { name, action, sessionId }) {
  const res = await fetchImpl("/routines", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, action, sessionId }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `routine ${action} failed (${res.status})`);
  return data;
}
