import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const installer = join(root, "scripts", "install.sh");

test("server installer is executable Bash", () => {
  assert.notEqual(statSync(installer).mode & 0o111, 0);
  execFileSync("bash", ["-n", installer]);
});

test("server installer documents secure defaults and optional features", () => {
  const help = execFileSync(installer, ["--help"], { encoding: "utf8" });
  assert.match(help, /127\.0\.0\.1/);
  assert.match(help, /--no-cloudflared/);
  assert.match(help, /--no-service/);
  assert.match(help, /--skip-system-packages/);
  assert.match(help, /HTTPS reverse proxy/);
});
