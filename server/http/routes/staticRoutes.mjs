import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

function isDocumentRoute(pathname) {
  return pathname === "/" || pathname === "/index.html"
    || /^\/s\/[\w.-]+(\/m\/[\w.-]+)?$/.test(pathname);
}

/** Build the unauthenticated UI-document and public-asset fallback route. */
export function createStaticRoutes({ config, requestContext }) {
  const publicDir = join(config.DIRNAME, "public");
  const distDir = join(config.DIRNAME, "dist");
  const serveDir = existsSync(join(distDir, "index.html")) ? distDir : publicDir;
  const indexPath = join(serveDir, "index.html");

  function serveDocument(res) {
    if (!existsSync(indexPath)) {
      res.writeHead(500, { "content-type": "text/plain" });
      res.end("public/index.html missing");
      return;
    }
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-cache",
    });
    res.end(readFileSync(indexPath));
  }

  function serveAsset(pathname, res) {
    let decoded;
    try { decoded = decodeURIComponent(pathname); } catch { return false; }
    const relative = decoded.replace(/^\/+/, "");
    const target = resolve(serveDir, relative);
    const confined = target === serveDir || target.startsWith(`${serveDir}/`);
    if (!confined || !existsSync(target) || statSync(target).isDirectory()) return false;
    res.writeHead(200, {
      "content-type": requestContext.mimeType(target),
      "cache-control": "no-cache",
    });
    createReadStream(target).pipe(res);
    return true;
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
