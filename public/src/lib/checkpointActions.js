async function jsonRequest(fetchImpl, url, body) {
  const res = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `failed (${res.status})`);
  return data;
}

export function openCheckpointModelPicker({ openPicker, rpc, setOptions, options = {} }) {
  const picker = openPicker({
    title: "Freeze checkpoint",
    hint: "The model summarizes the diff into the commit message. Your choice is remembered.",
    okLabel: "Freeze 🧊",
    ...options,
    loading: true,
  });
  rpc({ type: "get_available_models" })
    .then(({ models }) => setOptions(models.map((model) => `${model.provider}/${model.id}`)))
    .catch(() => setOptions([]));
  return picker;
}

export function createCheckpoint(fetchImpl, runner, model) {
  return jsonRequest(fetchImpl, `/checkpoint?runner=${encodeURIComponent(runner ?? "")}`, { model });
}

export function rollbackCheckpoint(fetchImpl, { sessionId, hash, model }) {
  return jsonRequest(fetchImpl, "/rollback", { sessionId, hash, model });
}
