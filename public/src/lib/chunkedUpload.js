const INITIAL_CHUNK_BYTES = 8 * 1024 * 1024;
const MIN_CHUNK_BYTES = 64 * 1024;
const MAX_RETRIES = 6;

/** Chunk size shared by the files of one batch, so a proxy limit is learned once. */
export function createUploadChunking() {
  return { size: INITIAL_CHUNK_BYTES };
}

/**
 * Upload one file through the resumable `/file-upload` contract.
 *
 * Chunks stay below common reverse-proxy body limits. If an intermediary has a
 * smaller limit, a 413 halves subsequent chunks and retries the same offset
 * instead of failing the whole file.
 */
export async function uploadFileInChunks({ uploadChunk, sleep, dir, file, chunking = createUploadChunking(), onProgress = () => {}, isCancelled = () => false }) {
  let offset = 0;
  let attempts = 0;
  while (true) {
    if (isCancelled()) return { cancelled: true };
    const end = Math.min(offset + chunking.size, file.size);
    const last = end >= file.size;
    let response;
    try { response = await uploadChunk({ dir, name: file.name, offset, last, body: file.slice(offset, end) }); }
    catch {
      if (++attempts > MAX_RETRIES) throw new Error(`connection lost (gave up after ${MAX_RETRIES} retries)`);
      await sleep(1000 * attempts);
      continue;
    }
    const { res, data } = response;
    if (res.ok) {
      attempts = 0;
      if (last || data.saved) {
        onProgress(file.size);
        return { path: typeof data.saved === "string" ? data.saved : `${String(dir).replace(/\/$/, "")}/${file.name}` };
      }
      offset = typeof data.received === "number" ? data.received : end;
      onProgress(offset);
      continue;
    }
    if (res.status === 409 && typeof data.have === "number") {
      if (++attempts > MAX_RETRIES) throw new Error(data.error || "upload out of sync");
      offset = data.have;
      continue;
    }
    if (res.status === 413 && chunking.size > MIN_CHUNK_BYTES) {
      chunking.size = Math.max(MIN_CHUNK_BYTES, Math.floor(Math.min(chunking.size, end - offset) / 2));
      attempts = 0;
      continue;
    }
    if (res.status >= 500 || res.status === 429) {
      if (++attempts > MAX_RETRIES) throw new Error(data.error || `upload failed (${res.status})`);
      await sleep(1000 * attempts);
      continue;
    }
    throw new Error(data.error || `upload failed (${res.status})`);
  }
}
