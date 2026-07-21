export async function browseFiles(fetchImpl, path = "") {
  const query = path ? `&path=${encodeURIComponent(path)}` : "";
  const res = await fetchImpl(`/browse?files=1${query}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "cannot open folder");
  return data;
}

export async function readFile(fetchImpl, path) {
  const res = await fetchImpl(`/file-content?path=${encodeURIComponent(path)}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "cannot open file");
  return data;
}

export async function uploadFileChunk(fetchImpl, { dir, name, offset, last, body }) {
  const url = `/file-upload?dir=${encodeURIComponent(dir)}&name=${encodeURIComponent(name)}` +
    `&offset=${offset}&last=${last ? 1 : 0}`;
  const res = await fetchImpl(url, { method: "POST", body });
  return { res, data: await res.json().catch(() => ({})) };
}

export function downloadFileUrl(token, path) {
  return `/file-download?token=${encodeURIComponent(token)}&path=${encodeURIComponent(path)}`;
}

export async function saveFile(fetchImpl, { path, content }) {
  const res = await fetchImpl("/file-save", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ path, content }) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `save failed (${res.status})`);
  return data;
}
