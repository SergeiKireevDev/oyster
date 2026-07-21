// Session-management e2e scenarios — driven entirely through the UI against
// the self-contained mock-LLM container:
//   A. start sessions + stop a session's background process
//   B. switch between sessions (and confirm the transcript follows)
//   C. search across sessions and jump to a hit
//   D. use a ":" prompt command (command palette)
//
// Distinct sessions are created by sending the mock a
// "Reply with exactly the word <TOKEN>" prompt — the mock echoes the token and
// the UI auto-titles the session after its first message, giving each row a
// stable, searchable handle.

import { test, expect } from "@playwright/test";
import { login, sendPrompt, waitFor, api, dexec, currentSessionId, MOBILE_VIEWPORT, swipe } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

// Per-test container lifecycle — see checkpoint-rollback.spec.js
test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

// The mock container persists sessions in /workspace across runs, and other
// specs also send "Reply with exactly the word X" prompts — so every session
// tag is made unique per run (the UI auto-titles a session after its first
// message, so a unique token => a unique, matchable row).
const RUN = Date.now();
const tag = (base) => `${base}-${RUN}`;

async function newSession(page) {
  await page.click("#menuBtn");
  await page.click('#menu button[data-action="newSession"]');
  // the toast confirms the freshly spawned runner took over as current
  await expect(page.locator(".toast", { hasText: "new session" })).toBeVisible({ timeout: 10000 });
}

async function openSessions(page) {
  await page.click("#menuBtn");
  await page.click('#menu button[data-action="sessions"]');
  await expect(page.locator("#mTitle")).toHaveText("Sessions");
}

async function newSessionInFolder(page, folderName) {
  await page.click("#menuBtn");
  await page.click('#menu button[data-action="newSessionIn"]');
  await expect(page.locator("#mTitle")).toHaveText("New session in folder");
  await page.locator("#mBody .m-option.dir", { hasText: folderName }).click();
  await expect(page.locator("#mBody .m-path", { hasText: `/workspace/${folderName}` }).first()).toHaveText(`/workspace/${folderName}`);
  await page.getByRole("button", { name: "Start session here" }).click();
  await expect(page.locator(".toast", { hasText: `folder: /workspace/${folderName}` })).toBeVisible({ timeout: 10000 });
}

async function loadOtherFolderAndSwitch(page, folderLabel, token) {
  await openSessions(page);
  await page.locator(".s-folders > summary").click();
  const folder = page.locator(".s-folder").filter({
    has: page.locator(":scope > summary", { hasText: folderLabel }),
  });
  await folder.locator(":scope > summary").click();
  const row = rowFor(page, token);
  await expect(row).toBeVisible({ timeout: 10000 });
  await row.click();
  await expect(page.locator(".toast", { hasText: /switched to/ })).toBeVisible({ timeout: 10000 });
}

// A session row in the picker that is titled/named after `token`.
function rowFor(page, token) {
  return page.locator(".m-option", { hasText: token });
}

async function installFakeCloudflared() {
  dexec(`bin=$(command -v cloudflared); cat > "$bin" <<'EOF'
#!/usr/bin/env bash
echo "https://e2e-\${RANDOM}-fake.trycloudflare.com" >&2
while true; do sleep 3600; done
EOF
chmod +x "$bin"`);
}

async function installSecondMockModel() {
  dexec(`cat > /root/.pi/agent/models.json <<'EOF'
{
  "providers": {
    "mock": {
      "baseUrl": "http://127.0.0.1:4010/v1",
      "api": "openai-completions",
      "apiKey": "sk-e2e-mock",
      "models": [
        { "id": "e2e-mock", "name": "E2E Mock", "reasoning": false, "input": ["text"], "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }, "contextWindow": 128000, "maxTokens": 4096 },
        { "id": "e2e-mock-b", "name": "E2E Mock B", "reasoning": false, "input": ["text"], "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 }, "contextWindow": 128000, "maxTokens": 4096 }
      ]
    }
  }
}
EOF`);
}

const RESOURCE_SCRIPT = `#!/bin/bash
set -u
case "\${1:-run}" in
  run) echo "::progress 100 complete" ;;
  teardown) echo "teardown complete" ;;
esac
`;

async function createBoundRoutine(name, sessionId) {
  const { status, json } = await api("POST", "/routines", { name, action: "create", script: RESOURCE_SCRIPT, sessionId });
  expect(status, json.error).toBe(201);
}

async function createBoundHublot(label, sessionId) {
  const { status, json } = await api("POST", "/tunnels", { label, sessionId });
  expect(status, json.error).toBe(201);
  return json.tunnel;
}

async function openResourceSidebarIfMobile(page, mobile) {
  if (!mobile) return;
  const open = await page.evaluate(() => document.getElementById("hublots")?.classList.contains("open"));
  if (!open) {
    await page.click("#hublotChip");
    await page.waitForFunction(() => document.getElementById("hublots")?.classList.contains("open"));
  }
}

async function closeResourceSidebarIfMobile(page, mobile) {
  if (mobile) await page.evaluate(() => document.getElementById("hublots")?.classList.remove("open"));
}

function modelChip(page, mobile) {
  return page.locator(mobile ? "#cfgChip" : "#modelChip");
}

async function expectSidebarResources(page, { hublots, routines, mobile = false }) {
  await openResourceSidebarIfMobile(page, mobile);
  for (const label of hublots) {
    await expect(page.locator("#hublotList .hublot-block", { hasText: label })).toBeVisible({ timeout: 30000 });
  }
  for (const name of routines) {
    await expect(page.locator("#routineList .routine-block", { hasText: name })).toBeVisible({ timeout: 30000 });
  }
}

async function switchToSessionByToken(page, token, { mobile = false } = {}) {
  await closeResourceSidebarIfMobile(page, mobile);
  await openSessions(page);
  await rowFor(page, token).click();
  await expect(page.locator(".toast", { hasText: /switched to/ })).toBeVisible({ timeout: 10000 });
}

function defineSessionManagementTests({ includeResourceSwitch = false, includeCrossDirectorySwitch = false, includeModalLifecycle = false, mobile = false } = {}) {
  test("shows active sessions in the desktop sidebar and right-swipe mobile drawer", async ({ page }) => {
    await login(page);
    const A = tag(`SIDEBAR-A-${mobile ? "M" : "D"}`);
    const B = tag(`SIDEBAR-B-${mobile ? "M" : "D"}`);
    await sendPrompt(page, `Reply with exactly the word ${A}`);
    await newSession(page);
    await sendPrompt(page, `Reply with exactly the word ${B}`);

    if (mobile) {
      await expect(page.locator("#sessions")).not.toBeVisible();
      await swipe(page, "right");
    }
    await expect(page.locator("#sessions")).toBeVisible();
    const first = page.locator("#sessions .session-sidebar-row", { hasText: A });
    await expect(first).toBeVisible({ timeout: 15000 });
    await page.locator("#sessions .session-sidebar-search").fill(A);
    const result = page.locator("#sessions .session-sidebar-hit", { hasText: A });
    await expect(result).toBeVisible({ timeout: 15000 });
    await expect(result.locator(".session-sidebar-snippet").first()).toContainText(A);
    await result.click();
    await expect(page.locator("#messages")).toContainText(A, { timeout: 15000 });
  });

  test("start sessions and stop a session's background process", async ({ page }) => {
    await login(page);

    // two fresh sessions, each tagged with a unique token
    const A = tag("ALPHA");
    const B = tag("BETA");
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${A}.`);
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${B}.`);

    // S2 (B) is now current
    await expect(page.locator(".msg.assistant", { hasText: B }).last()).toBeVisible();

    await openSessions(page);
    // both rows are present and active (each gets a ■ stop control)
    const alpha = rowFor(page, A);
    const beta = rowFor(page, B);
    await expect(alpha).toBeVisible();
    await expect(beta).toBeVisible();
    await expect(alpha.locator(".s-stop")).toBeVisible();
    await expect(beta.locator(".s-stop")).toBeVisible();

    // stop ALPHA's background process
    await alpha.locator(".s-stop").click();
    await expect(page.locator(".toast", { hasText: /process stopped/ })).toBeVisible({ timeout: 10000 });

    // the stop control for ALPHA is now hidden (session went inactive); BETA's
    // remains visible — proving the kill was scoped to that one runner
    await expect(alpha.locator(".s-stop")).toBeHidden();
    await expect(beta.locator(".s-stop")).toBeVisible();

    // confirm via the server that ALPHA's runner process is gone while BETA
    // lives. The mock doesn't persist the auto-title as a session name, so key
    // by first-message preview and join sessions to runners through the opaque
    // backend-neutral session key rather than a storage-path assumption.
    const byKey = async () => {
      const [{ json: ss }, { json: rs }] = await Promise.all([api("GET", "/sessions?dir=/workspace"), api("GET", "/runners")]);
      const sessions = (ss.sessions ?? []).map((s) => ({
        ...s,
        runner: (rs.runners ?? []).find((r) => r.sessionKey === s.sessionKey),
      }));
      return {
        alpha: sessions.find((s) => (s.preview ?? "").includes(A)),
        beta: sessions.find((s) => (s.preview ?? "").includes(B)),
      };
    };
    await waitFor(
      async () => {
        const { alpha, beta } = await byKey();
        return alpha && beta && !alpha.runner?.alive && beta.runner?.alive;
      },
      { timeout: 15000, label: "ALPHA stopped, BETA still running" }
    );
  });

  test("switch between sessions — transcript follows the selection", async ({ page }) => {
    await login(page);

    const G = tag("GAMMA");
    const D = tag("DELTA");
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${G}.`);
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${D}.`);

    // currently in DELTA
    await expect(page.locator(".msg.assistant", { hasText: D }).last()).toBeVisible();

    // switch back to GAMMA via the picker
    await openSessions(page);
    await rowFor(page, G).click();
    await expect(page.locator(".toast", { hasText: /switched to/ })).toBeVisible({ timeout: 10000 });

    // the transcript reloads to GAMMA's content (and DELTA's is gone)
    await expect(page.locator(".msg.assistant", { hasText: G }).last()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".msg.assistant", { hasText: D })).toHaveCount(0);

    // and the reverse works too
    await openSessions(page);
    await rowFor(page, D).click();
    await expect(page.locator(".msg.assistant", { hasText: D }).last()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".msg.assistant", { hasText: G })).toHaveCount(0);
  });

  if (includeModalLifecycle) test("sessions modal stays current while adding, stopping, and deleting sessions across directories", async ({ page }) => {
    await login(page);

    const A = tag("MODAL-A");
    const B = tag("MODAL-B");
    const C = tag("MODAL-C");
    const folderB = `modal-b-${RUN}`;
    const folderC = `modal-c-${RUN}`;
    dexec(`mkdir -p /workspace/${folderB} /workspace/${folderC}`);

    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${A}.`);
    await newSessionInFolder(page, folderB);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${B}.`);
    await loadOtherFolderAndSwitch(page, "/workspace", A);

    await openSessions(page);
    await expect(rowFor(page, A)).toBeVisible();
    await expect(rowFor(page, B)).toBeVisible();

    // Add a third session out-of-band while the modal remains open. The live
    // runner update must make it appear without closing or refreshing.
    const opened = await api("POST", "/open-session", { dir: `/workspace/${folderC}` });
    expect(opened.status, opened.json.error).toBe(200);
    const prompted = await api("POST", `/rpc?runner=${encodeURIComponent(opened.json.runner.id)}`, {
      type: "prompt",
      message: `Do not use any tools. Reply with exactly the word ${C}.`,
    });
    expect(prompted.status, prompted.json.error).toBe(202);
    await expect(rowFor(page, C)).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".s-session-main:visible")).toHaveCount(3);

    // Stopping B immediately moves it out of the active section, while A and C
    // remain visible and active.
    await rowFor(page, B).locator(".s-stop").click();
    await expect(page.locator(".toast", { hasText: /process stopped/ })).toBeVisible();
    await expect(rowFor(page, B)).toBeHidden();
    await expect(rowFor(page, A)).toBeVisible();
    await expect(rowFor(page, C)).toBeVisible();
    await expect(page.locator(".s-session-main:visible")).toHaveCount(2);

    // The stopped session remains available under its folder and can be
    // deleted. Its now-empty folder must disappear immediately.
    await page.locator(".s-folders > summary").click();
    const bFolder = page.locator(".s-folder").filter({ has: page.locator(":scope > summary", { hasText: `/workspace/modal/b/${RUN}` }) });
    await bFolder.locator(":scope > summary").click();
    await expect(rowFor(page, B)).toBeVisible();
    page.once("dialog", (dialog) => dialog.accept());
    await rowFor(page, B).locator(".s-del:not(.s-stop)").click();
    await expect(page.locator(".toast", { hasText: /session deleted/ })).toBeVisible();
    await expect(rowFor(page, B)).toHaveCount(0);
    await expect(page.locator(".s-folder > summary", { hasText: `/workspace/modal/b/${RUN}` })).toHaveCount(0);

    // Deleting the newly-added active session also updates the open modal and
    // leaves the unrelated active session untouched.
    page.once("dialog", (dialog) => dialog.accept());
    await rowFor(page, C).locator(".s-del:not(.s-stop)").click();
    await expect(rowFor(page, C)).toHaveCount(0);
    await expect(page.locator(".s-folder > summary", { hasText: `/workspace/${folderC}` })).toHaveCount(0);
    await expect(rowFor(page, A)).toBeVisible();
    await expect(page.locator(".s-session-main:visible")).toHaveCount(1);
  });

  if (includeCrossDirectorySwitch) test("switch sessions across working directories in both directions", async ({ page }) => {
    await login(page);

    const A = tag("WORKDIR-A");
    const B = tag("WORKDIR-B");
    const otherFolder = `other-${RUN}`;
    dexec(`mkdir -p /workspace/${otherFolder}`);

    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${A}.`);

    await newSessionInFolder(page, otherFolder);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${B}.`);
    await expect(page.locator("#workdirInfo")).toContainText(`/workspace/${otherFolder}`);
    await expect(page.locator(".msg.assistant", { hasText: B }).last()).toBeVisible();

    await loadOtherFolderAndSwitch(page, "/workspace", A);
    await expect(page.locator("#workdirInfo")).toContainText("/workspace");
    await expect(page.locator(".msg.assistant", { hasText: A }).last()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".msg.assistant", { hasText: B })).toHaveCount(0);

    // Session-folder labels decode hyphens as separators.
    await loadOtherFolderAndSwitch(page, `/workspace/other/${RUN}`, B);
    await expect(page.locator("#workdirInfo")).toContainText(`/workspace/${otherFolder}`);
    await expect(page.locator(".msg.assistant", { hasText: B }).last()).toBeVisible({ timeout: 15000 });
    await expect(page.locator(".msg.assistant", { hasText: A })).toHaveCount(0);
  });

  test("search across sessions and jump to a hit", async ({ page }) => {
    await login(page);

    // a session whose transcript holds a token unique to this run
    const NEEDLE = tag("XYZZYKITE");
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${NEEDLE}.`);

    await openSessions(page);
    const searchBox = page.locator("#mBody .search-row input[type=text]");
    await expect(searchBox).toBeVisible();
    await searchBox.fill(NEEDLE);
    await searchBox.press("Enter");

    // our needle surfaces as a highlighted hit (it matches the user message
    // and the assistant's echoed reply, hence 2 hits) in exactly one session card
    await expect(page.locator(".m-path", { hasText: /hits in/i })).toBeVisible({ timeout: 15000 });
    const hit = page.locator(".search-hit").filter({ hasText: NEEDLE }).first();
    await expect(hit).toBeVisible();
    // the matched token is highlighted (one <mark> per shown snippet — assert the
    // first one carries the needle)
    await expect(hit.locator("mark").first()).toHaveText(NEEDLE);

    // clicking the hit switches to that session and flashes the matching message
    await hit.click();
    await waitFor(
      () => page.locator(".msg").filter({ hasText: NEEDLE }).count().then((c) => c > 0),
      { timeout: 15000, label: "needle visible in transcript after jumping to the hit" }
    );
  });

  test("use a ':' prompt command", async ({ page }) => {
    await login(page);

    // type ":" in the composer to open the command palette
    await page.fill("#input", ":file");
    const palette = page.locator("#cmdPalette");
    await expect(palette).toHaveClass(/open/);
    await expect(palette.locator(".cmd-row", { hasText: "file explorer" })).toBeVisible();

    // the active command can be run with Enter — it opens the file picker modal
    await page.keyboard.press("Enter");
    // palette closes and the app route overlay opens to pick a file
    await expect(palette).not.toHaveClass(/open/);
    await page.waitForFunction(() => document.getElementById("overlay")?.classList.contains("open"), null, {
      timeout: 10000,
    });
    // the file picker lists the workspace contents
    await expect(page.locator("#modal", { hasText: "file" })).toBeVisible();
  });

  test("switching sessions restores each session's model", async ({ page }) => {
    await installSecondMockModel();
    await login(page);

    const A = tag("MODEL-A");
    const B = tag("MODEL-B");

    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${A}.`);
    await expect(modelChip(page, mobile)).toContainText("e2e-mock", { timeout: 15000 });

    await newSession(page);
    await page.evaluate(async () => {
      await rpc({ type: "set_model", provider: "mock", modelId: "e2e-mock-b" });
      await refreshState();
    });
    await expect(modelChip(page, mobile)).toContainText("e2e-mock-b", { timeout: 15000 });
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${B}.`);

    await switchToSessionByToken(page, A, { mobile });
    await expect(page.locator(".msg.assistant", { hasText: A }).last()).toBeVisible({ timeout: 15000 });
    await expect(modelChip(page, mobile)).toContainText("e2e-mock", { timeout: 15000 });

    await switchToSessionByToken(page, B, { mobile });
    await expect(page.locator(".msg.assistant", { hasText: B }).last()).toBeVisible({ timeout: 15000 });
    await expect(modelChip(page, mobile)).toContainText("e2e-mock-b", { timeout: 15000 });
  });

  if (includeResourceSwitch) test("switching sessions restores session-scoped hublots, routines, and model", async ({ page }) => {
    await installSecondMockModel();
    await installFakeCloudflared();
    await login(page);

    const A = tag("RESOURCES-A");
    const B = tag("RESOURCES-B");
    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${A}.`);
    const sessionA = await waitFor(() => currentSessionId(page), { timeout: 30000, label: "session A id" });
    await expect(modelChip(page, mobile)).toContainText("e2e-mock");

    const aHublots = [tag("hublot-a-1"), tag("hublot-a-2")];
    const aRoutines = [tag("routine-a-1") + ".sh", tag("routine-a-2") + ".sh"];
    for (const label of aHublots) await createBoundHublot(label, sessionA);
    for (const name of aRoutines) await createBoundRoutine(name, sessionA);
    await page.evaluate(() => { loadHublots(); loadRoutines(); });
    await expectSidebarResources(page, { hublots: aHublots, routines: aRoutines, mobile });
    await closeResourceSidebarIfMobile(page, mobile);

    await newSession(page);
    await sendPrompt(page, `Do not use any tools. Reply with exactly the word ${B}.`);
    const sessionB = await waitFor(() => currentSessionId(page), { timeout: 30000, label: "session B id" });
    expect(sessionB).not.toEqual(sessionA);

    await page.evaluate(async () => {
      await rpc({ type: "set_model", provider: "mock", modelId: "e2e-mock-b" });
      await refreshState();
    });
    await expect(modelChip(page, mobile)).toContainText("e2e-mock-b", { timeout: 15000 });

    const bHublots = [tag("hublot-b-1")];
    const bRoutines = [tag("routine-b-1") + ".sh"];
    for (const label of bHublots) await createBoundHublot(label, sessionB);
    for (const name of bRoutines) await createBoundRoutine(name, sessionB);
    await page.evaluate(() => { loadHublots(); loadRoutines(); });
    await expectSidebarResources(page, { hublots: bHublots, routines: bRoutines, mobile });
    await expect(page.locator("#hublotList")).not.toContainText(aHublots[0]);
    await expect(page.locator("#routineList")).not.toContainText(aRoutines[0]);
    await closeResourceSidebarIfMobile(page, mobile);

    await switchToSessionByToken(page, A, { mobile });
    await expect(modelChip(page, mobile)).toContainText("e2e-mock", { timeout: 15000 });
    await expectSidebarResources(page, { hublots: aHublots, routines: aRoutines, mobile });
    await expect(page.locator("#hublotList")).not.toContainText(bHublots[0]);
    await expect(page.locator("#routineList")).not.toContainText(bRoutines[0]);
    await closeResourceSidebarIfMobile(page, mobile);

    await switchToSessionByToken(page, B, { mobile });
    await expect(modelChip(page, mobile)).toContainText("e2e-mock-b", { timeout: 15000 });
    await expectSidebarResources(page, { hublots: bHublots, routines: bRoutines, mobile });
    await expect(page.locator("#hublotList")).not.toContainText(aHublots[0]);
    await expect(page.locator("#routineList")).not.toContainText(aRoutines[0]);
  });
}

test.describe.serial("desktop session management", () => {
  defineSessionManagementTests({ includeResourceSwitch: true, includeCrossDirectorySwitch: true, includeModalLifecycle: true });
});

test.describe.serial("mobile session management", () => {
  test.use({ viewport: MOBILE_VIEWPORT });
  defineSessionManagementTests({ includeResourceSwitch: true, mobile: true });
});
