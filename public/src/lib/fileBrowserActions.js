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
