// Feature 3 — Start a session in a git repo, commit some changes, freeze
// (checkpoint), recommit some others, freeze again, then roll back to the
// first freeze from the UI.
//
// The checkpoint 🧊 button anchors to the LAST chat message, and the UI shows
// one ↩ rollback arrow per anchored message (latest checkpoint per message).
// So we seed two messages and freeze after each, giving two independent
// rollback points, then roll back to the first one.

import { test, expect } from "@playwright/test";
import { login, dexec, sendPrompt, waitFor, currentSessionId } from "./lib/harness.js";

const DIR = "/workspace";
const NOTES = `${DIR}/e2e-notes.txt`;

const headShort = () => dexec(`git -C ${DIR} rev-parse --short HEAD`);

test.beforeAll(() => {
  // fresh git repo with a baseline commit
  dexec(`
    set -e
    rm -rf ${DIR}/.git ${DIR}/e2e-*.txt
    cd ${DIR}
    git init -q
    git config user.email e2e@example.com
    git config user.name e2e
    git config commit.gpgsign false
    printf 'alpha\\n' > e2e-notes.txt
    git add -A && git commit -q -m 'baseline'
  `);
});

test("commit, freeze, recommit, freeze, then roll back to the first checkpoint", async ({ page }) => {
  await login(page);
  // Use the session the UI loads with. (Opening a brand-new session races: the
  // old session id stays truthy until the new runner's get_state lands, so
  // capturing it here would grab the wrong id.)
  const mainSession = await waitFor(() => currentSessionId(page), {
    timeout: 30000, label: "a session id",
  });

  const H0 = headShort();

  // ---- message 1 + change set 1 -> freeze -> H1
  await sendPrompt(page, "Do not use any tools. Reply with exactly the word ALPHA.");
  dexec(`cd ${DIR} && printf 'beta\\n' >> e2e-notes.txt && printf 'b\\n' > e2e-b.txt`);
  await freeze(page);
  const H1 = await waitFor(() => (headShort() !== H0 ? headShort() : null), {
    timeout: 30000, label: "first checkpoint commit",
  });

  // the rollback arrow for H1 should now be on message 1
  await expect(page.locator(`.ckpt-restore[title*="${H1}"]`)).toHaveCount(1, { timeout: 15000 });

  // ---- message 2 + change set 2 -> freeze -> H2
  await sendPrompt(page, "Do not use any tools. Reply with exactly the word GAMMA.");
  dexec(`cd ${DIR} && printf 'gamma\\n' >> e2e-notes.txt && printf 'c\\n' > e2e-c.txt`);
  await freeze(page);
  const H2 = await waitFor(() => (headShort() !== H1 ? headShort() : null), {
    timeout: 30000, label: "second checkpoint commit",
  });
  expect(H2).not.toEqual(H1);

  // both checkpoints are recorded for this session (a reused container may
  // carry checkpoints from earlier runs, so assert containment, not equality)
  await expect
    .poll(async () => {
      const r = await page.evaluate(async (sid) => {
        const res = await fetch(`/checkpoints?id=${encodeURIComponent(sid)}`);
        return (await res.json()).checkpoints?.map((c) => c.hash) ?? [];
      }, mainSession);
      return r.includes(H1) && r.includes(H2);
    })
    .toBe(true);

  // ---- roll back to H1 via its ↩ arrow
  await page.locator(`.ckpt-restore[title*="${H1}"]`).first().click();
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  await page.getByRole("button", { name: /Roll back/ }).click();

  // a forked session opens (new session id), titled with the rollback marker
  await expect.poll(() => currentSessionId(page), { timeout: 30000 }).not.toEqual(mainSession);
  await expect(page.locator("#sessionTitle")).toContainText(H1, { timeout: 15000 });

  // the workdir is deterministically restored to H1:
  await waitFor(() => headShort() === H1, { timeout: 15000, label: "workdir reset to H1" });
  expect(dexec(`cat ${NOTES}`)).toEqual("alpha\nbeta");           // gamma is gone
  expect(dexec(`test -f ${DIR}/e2e-b.txt && echo y || echo n`)).toEqual("y"); // b existed at H1
  expect(dexec(`test -f ${DIR}/e2e-c.txt && echo y || echo n`)).toEqual("n"); // c came after H1
});

/** Click the 🧊 checkpoint button and confirm the freeze modal (no summary). */
async function freeze(page) {
  await page.locator(".checkpoint").click();
  await expect(page.locator("#overlay")).toHaveClass(/open/);
  // leave the model selector at its default ("No summary — timestamp message")
  await page.getByRole("button", { name: /Freeze/ }).click();
  await expect(page.locator("#overlay")).not.toHaveClass(/open/);
}

test.afterAll(() => {
  dexec(`rm -rf ${DIR}/.git ${DIR}/e2e-*.txt`, { allowFail: true });
});
