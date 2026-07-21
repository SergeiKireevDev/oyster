import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const runbook = readFileSync(new URL("../docs/app-data-migration.md", import.meta.url), "utf8");

test("migration runbook covers backup, restore, downgrade, and failure recovery", () => {
  for (const heading of ["## Back up before cutover", "## Restore the application database", "## Downgrade", "## Failure recovery"]) {
    assert.match(runbook, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(runbook, /--dry-run --service-stopped/);
  assert.match(runbook, /--apply --service-stopped/);
  assert.match(runbook, /legacy_migration_ledger/);
  assert.match(runbook, /retain(?:ed)? through at least the next oyster release/i);
});

test("runbook keeps application backups isolated from coding-agent stores", () => {
  assert.match(runbook, /never copy, replace, delete, or migrate those stores/i);
  assert.match(runbook, /Do not start an older binary against a newer `oyster\.sqlite`/);
  assert.match(runbook, /database and its sidecars/);
  assert.match(runbook, /legacy sources remain at their original paths/);
});
