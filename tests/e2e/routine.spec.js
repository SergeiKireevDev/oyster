// Feature 2 — Start a session, create a dummy routine and run it.
//
// A routine is any executable in ~/.pi/routines/. We create a dummy one (that
// reports progress, drops a byproduct on `run`, and removes it on `teardown`),
// then drive it entirely from the UI sidebar: ▶ start, watch it reach 100% /
// done, then 🧹 teardown and watch the byproduct disappear.

import { test, expect } from "@playwright/test";
import { login, dexec, waitFor } from "./lib/harness.js";

const NAME = "e2e-dummy.sh";
const ARTIFACT = "/workspace/.e2e-routine-artifact";

// Only `${1:-run}` needs escaping so JS doesn't interpolate it; `$mode` /
// `$artifact` are safe in a template literal (no brace after the dollar).
const SCRIPT = `#!/usr/bin/env bash
set -u
mode="\${1:-run}"
artifact="${ARTIFACT}"
if [ "$mode" = "teardown" ]; then
  echo "::progress 50 removing byproducts"
  rm -f "$artifact"
  echo "::progress 100 removed"
  exit 0
fi
echo "::progress 0 starting"
sleep 1
echo "::progress 40 building"
touch "$artifact"
sleep 1
echo "::progress 80 finishing"
sleep 1
echo "::progress 100 complete"
`;

test.beforeAll(() => {
  // "create" the routine in the global store (a script file in ~/.pi/routines/)
  dexec(`mkdir -p "$HOME/.pi/routines" && rm -f "$HOME/.pi/routines/${NAME}"`);
  dexec(`cat > "$HOME/.pi/routines/${NAME}" <<'PIEOF'\n${SCRIPT}\nPIEOF`);
  dexec(`chmod +x "$HOME/.pi/routines/${NAME}"`);
  dexec(`rm -f ${ARTIFACT}`);
});

test("start a session, then run and tear down a dummy routine from the sidebar", async ({ page }) => {
  await login(page); // initial load fetches the routine list -> our routine shows

  const block = page.locator(".routine-block", { hasText: NAME });
  await expect(block).toBeVisible({ timeout: 30000 });

  // ▶ start
  await block.getByRole("button", { name: /start/ }).click();

  // it should go running (status dot) and then reach done
  await expect(block.locator(".r-dot.running")).toBeVisible({ timeout: 15000 });
  await expect(block.locator(".r-dot.done")).toBeVisible({ timeout: 30000 });

  // byproduct exists after a successful run
  await waitFor(
    () => dexec(`test -f ${ARTIFACT} && echo yes || echo no`) === "yes",
    { timeout: 10000, label: "routine byproduct to be created" }
  );

  // 🧹 teardown removes the byproduct and returns the routine to idle
  await block.getByRole("button", { name: /teardown/ }).click();
  await waitFor(
    () => dexec(`test -f ${ARTIFACT} && echo yes || echo no`) === "no",
    { timeout: 15000, label: "routine byproduct to be removed" }
  );
  await expect(block.locator(".r-dot.running")).toHaveCount(0);
});

test.afterAll(() => {
  dexec(`rm -f "$HOME/.pi/routines/${NAME}" ${ARTIFACT}`, { allowFail: true });
});
