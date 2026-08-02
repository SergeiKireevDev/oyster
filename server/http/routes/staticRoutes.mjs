import {
  closeSync,
  constants,
  createReadStream,
  fstatSync,
  openSync,
  realpathSync,
  statSync,
} from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pipeline } from "node:stream";

function isDocumentRoute(pathname) {
  return pathname === "/" || pathname === "/index.html"
    || /^\/s\/[\w.-]+(\/m\/[\w.-]+)?$/.test(pathname);
}

function isWithin(path, root) {
  const relationship = relative(root, path);
  return relationship === ""
    || (!isAbsolute(relationship) && relationship !== ".." && !relationship.startsWith(`..${sep}`));
}

function canonicalDirectory(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function hasConfinedIndex(directory) {
  const root = canonicalDirectory(directory);
  if (!root) return false;
  try {
    const index = realpathSync(join(directory, "index.html"));
    return isWithin(index, root) && statSync(index).isFile();
  } catch {
    return false;
  }
}

/** Build the unauthenticated UI-document and public-asset fallback route. */
export function createStaticRoutes(options = {}) {
  const { config, requestContext } = options;
  if (!config || typeof config !== "object" || typeof config.DIRNAME !== "string" || !config.DIRNAME) {
    throw new TypeError("config.DIRNAME is required");
  }
  if (!requestContext || typeof requestContext.mimeType !== "function") {
    throw new TypeError("requestContext.mimeType is required");
  }

  const publicDir = join(config.DIRNAME, "public");
  const distDir = join(config.DIRNAME, "dist");
  const serveDir = hasConfinedIndex(distDir) ? distDir : publicDir;
  const canonicalServeDir = canonicalDirectory(serveDir);
  const indexPath = join(serveDir, "index.html");
  const openFlags = constants.O_RDONLY | (constants.O_NONBLOCK ?? 0) | (constants.O_NOFOLLOW ?? 0);

  function openFile(path) {
    if (!canonicalServeDir) return null;
    let descriptor;
    try {
      const canonicalPath = realpathSync(path);
      if (!isWithin(canonicalPath, canonicalServeDir)) return null;
      descriptor = openSync(canonicalPath, openFlags);
      const stats = fstatSync(descriptor);
      if (!stats.isFile()) {
        closeSync(descriptor);
        return null;
      }
      return { descriptor, canonicalPath, size: stats.size };
    } catch {
      if (descriptor !== undefined) {
        try { closeSync(descriptor); } catch { /* The failed operation may already have closed it. */ }
      }
      return null;
    }
  }

  function serveFile(path, res, contentType) {
    const opened = openFile(path);
    if (!opened) return false;

    let stream;
    try {
      stream = createReadStream(opened.canonicalPath, {
        fd: opened.descriptor,
        autoClose: true,
      });
      res.writeHead(200, {
        "content-type": contentType,
        "content-length": opened.size,
        "cache-control": "no-cache",
        "x-content-type-options": "nosniff",
      });
    } catch (error) {
      if (stream) stream.destroy();
      else {
        try { closeSync(opened.descriptor); } catch { /* Preserve the response error. */ }
      }
      throw error;
    }

    // pipeline closes the file descriptor if either peer aborts and consumes
    // read errors instead of allowing an unhandled stream error to crash Node.
    pipeline(stream, res, () => {});
    return true;
  }

  function serveDocument(res) {
    if (serveFile(indexPath, res, "text/html; charset=utf-8")) return;
    const body = "public/index.html missing";
    res.writeHead(500, {
      "content-type": "text/plain; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(body);
  }

  function serveAsset(pathname, res) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return false; }
    if (decoded.includes("\0")) return false;
    const relativePath = decoded.replace(/^\/+/, "");
    const target = resolve(serveDir, relativePath);
    if (!isWithin(target, resolve(serveDir))) return false;
    return serveFile(target, res, requestContext.mimeType(target));
  }

  return {
    "GET /*": (_req, res, url) => {
      if (isDocumentRoute(url.pathname)) {
        serveDocument(res);
        return true;
      }
      return serveAsset(url.pathname, res);
    },
  };
}
