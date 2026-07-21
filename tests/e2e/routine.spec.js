// Feature 2 — Start a session, create a dummy routine and run it.
//
// A routine is any executable in ~/.pi/routines/. We create a dummy one (that
// reports progress, drops a byproduct on `run`, and removes it on `teardown`),
// then drive it entirely from the UI sidebar: ▶ start, watch it reach 100% /
// done, then 🧹 teardown and watch the byproduct disappear.

import { test, expect } from "@playwright/test";
import { login, dexec, waitFor } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

const NAME = "e2e-dummy.sh";
const ARTIFACT = "/workspace/.e2e-routine-artifact";

// Only `${1:-run}` needs escaping so JS doesn't interpolate it; `$mode` /
// `$artifact` are safe in a template literal (no brace after the dollar).
const SCRIPT = `#!/bin/bash
set -e
mode=\${1:-run}
artifact=${ARTIFACT}
case "$mode" in
  run)
    echo "::progress 25 starting"
    sleep 1
    echo "::progress 50 half done"
    sleep 1
    echo "::progress 75 almost"
    sleep 1
    printf 'byproduct' > "$artifact"
    echo "::progress 100 complete"
    ;;
  teardown)
    rm -f "$artifact"
    echo "byproduct removed"
    ;;
esac
`;

// Per-test container lifecycle (see checkpoint-rollback.spec.js).
// beforeEach starts a container; afterEach tears it down — so this spec and
// the next spec never share workspace state. Routine setup runs inside
// beforeEach (not beforeAll) because it needs a live container.
test.beforeEach(async () => {
  await ensureContainer();
  dexec(`mkdir -p "$HOME/.pi/routines" && rm -f "$HOME/.pi/routines/${NAME}"`);
  dexec(`cat > "$HOME/.pi/routines/${NAME}" <<'PIEOF'\n${SCRIPT}\nPIEOF`);
  dexec(`chmod +x "$HOME/.pi/routines/${NAME}"`);
  dexec(`rm -f ${ARTIFACT}`);
});
test.afterEach(() => { teardownContainer(); });

test("start a session, then run and tear down a dummy routine from the sidebar", async ({ page }) => {
  await login(page); // initial load fetches the routine list -> our routine shows

  const block = page.locator(".routine-block", { hasText: NAME });
  await expect(block).toBeVisible({ timeout: 30000 });

  // ▶ start
  await block.getByRole("button", { name: /start/ }).click();

  // watch it reach 100% (the block shows the running→done state)
  await expect(block).toContainText("100%", { timeout: 60000 });
  await expect(block.locator(".r-dot")).toHaveClass(/done/, { timeout: 10000 });

  // confirm the byproduct exists
  await waitFor(
    () => dexec(`test -f ${ARTIFACT} && echo y || echo n`).then((r) => r === "y"),
    { timeout: 10000, label: "routine byproduct on disk" },
  );

  // 🧹 teardown
  await block.getByRole("button", { name: /teardown/ }).click();
  await expect(block.locator(".r-dot")).toHaveClass(/done|stopped/, { timeout: 60000 });

  // byproduct is gone
  await waitFor(
    () => dexec(`test -f ${ARTIFACT} && echo y || echo n`).then((r) => r === "n"),
    { timeout: 10000, label: "byproduct removed after teardown" },
  );
});
