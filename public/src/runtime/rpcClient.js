export function createRpcClient({ getRunner, getToken, onUnauthorized, onPendingResume, timeoutMs = 60000 }) {
  const clientId = Math.random().toString(36).slice(2, 8);
  let sequence = 0;
  const pending = new Map();

  async function rpc(command, { wait = true } = {}) {
    const id = `${clientId}-${++sequence}`;
    const cmd = { id, ...command };
    const waiter = wait ? new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`timeout waiting for ${cmd.type}`)); }
      }, timeoutMs);
    }) : null;
    const res = await fetch(`/rpc?runner=${encodeURIComponent(getRunner() ?? "")}`, {
      method: "POST", headers: { "content-type": "application/json", "x-auth-token": getToken() }, body: JSON.stringify(cmd),
    });
    if (res.status === 401) { onUnauthorized(); throw new Error("unauthorized"); }
    if (!res.ok) throw new Error(`rpc failed: ${res.status}`);
    const ack = await res.json().catch(() => null);
    if (ack?.pendingResume && cmd.type === "prompt") onPendingResume();
    return waiter;
  }

  function handleResponse(msg) {
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.success) waiter.resolve(msg.data); else waiter.reject(new Error(msg.error || "command failed"));
  }
  return { rpc, handleResponse };
}
