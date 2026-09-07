import { Transform } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/** Guard native diagnostic/protocol streams before runner logging, SSE or sinks. */
export function redactChildOutput(child, secrets = []) {
  const values = [...new Set(secrets.filter((value) => typeof value === "string" && value))];
  if (!values.length) return child;
  const overlap = Math.max(...values.map((value) => value.length)) - 1;
  for (const name of ["stdout", "stderr"]) {
    if (!child[name]?.pipe) continue;
    const decoder = new StringDecoder("utf8");
    let pending = "";
    const redact = (text) => values.reduce((result, value) => result.split(value).join("[REDACTED]"), text);
    child[name] = child[name].pipe(new Transform({
      transform(chunk, _encoding, callback) {
        pending += decoder.write(chunk);
        // Split only at a newline, or sufficiently far before an incomplete
        // key. Protocol lines should not be delayed waiting for another event.
        let end = pending.lastIndexOf("\n") + 1;
        if (!end && pending.length > 1024 * 1024) end = pending.length - overlap;
        if (end) {
          // Do not cut through a key spanning a forced boundary.
          for (const value of values) {
            const index = pending.lastIndexOf(value, end - 1);
            if (index >= 0 && index + value.length > end) end = index;
          }
          this.push(redact(pending.slice(0, end)));
          pending = pending.slice(end);
        }
        callback();
      },
      flush(callback) { this.push(redact(pending + decoder.end())); callback(); },
    }));
  }
  return child;
}
