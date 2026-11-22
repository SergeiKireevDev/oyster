// Threads: selecting text in a reply offers question buttons; a question forks
// the session into a thread that opens in place of the transcript, stays out
// of the session list, and is reachable from the reply, the thread header and
// the tree behind the composer's tree button.

import { test, expect } from "@playwright/test";
import { api, login, sendPrompt } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

const REPLY_TEXT = '.assistant-entry[data-role="assistant"] [data-assistant-part="text"] .md';

/**
 * The transcript is re-rendered from the saved session shortly after a turn
 * ends, which drops any selection. Wait until the newest reply's element has
 * survived a few checks, as a reader who finished reading before selecting.
 */
async function transcriptSettled(page) {
  await expect.poll(() => page.evaluate((selector) => {
    const newest = [...document.querySelectorAll(selector)].at(-1) ?? null;
    const state = window.__threadsSpecSettle ??= { node: null, stable: 0 };
    state.stable = newest && newest === state.node ? state.stable + 1 : 0;
    state.node = newest;
    return state.stable;
  }, REPLY_TEXT), { intervals: [400], timeout: 20000 }).toBeGreaterThanOrEqual(4);
}

/** Select `text` inside the newest reply that contains it, as a user dragging over it would. */
async function selectReplyText(page, text) {
  await transcriptSettled(page);
  await page.evaluate(([selector, needle]) => {
    const part = [...document.querySelectorAll(selector)].findLast((element) => element.textContent.includes(needle));
    if (!part) throw new Error(`no reply contains: ${needle}`);
    const walker = document.createTreeWalker(part, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const index = node.textContent.indexOf(needle);
      if (index === -1) continue;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + needle.length);
      const selection = document.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      return;
    }
    throw new Error(`reply text is split across nodes: ${needle}`);
  }, [REPLY_TEXT, text]);
  await expect(page.getByRole("toolbar", { name: "Ask about the selected text" })).toBeVisible();
}

const ask = (page, question) => page.getByRole("toolbar", { name: "Ask about the selected text" }).getByRole("button", { name: question, exact: true }).click();
const header = (page) => page.locator(".thread-header");
const crumbs = (page) => header(page).locator(".thread-crumb");
const sessionPath = (page) => new URL(page.url()).pathname;

async function agentIdle(page) {
  await expect(page.locator("#connDot")).toHaveClass(/\bok\b/);
  await expect(page.locator("#connDot")).not.toHaveClass(/\bbusy\b/);
}

/** The thread's own transcript: its question, then at least one reply. */
async function expectThreadAnswered(page, question) {
  await expect(page.locator('#messages [data-role="user"]').last()).toContainText(question);
  await expect.poll(() => page.locator("#messages .msg.assistant").count()).toBeGreaterThan(0);
  await agentIdle(page);
}

const threadSessions = async () => (await api("GET", "/sessions?all=1")).json.sessions.filter((session) => session.thread);

test("a question about selected text opens a thread that lives inside its session", async ({ page }) => {
  await login(page);
  await sendPrompt(page, "Reply with exactly the word Supercalifragilistic");
  const rootPath = sessionPath(page);

  // Selecting text in a reply offers the three presets and a free-form question.
  await selectReplyText(page, "Supercalifragilistic");
  await expect(page.locator(".thread-question")).toHaveText(["Why?", "What?", "How?", "Other…"]);
  await ask(page, "Why?");

  // The thread replaces the transcript: where it hangs, what it is about, and only its own messages.
  await expect(crumbs(page)).toHaveText(["Supercalifragilistic", "Why?"]);
  await expect(header(page).locator(".thread-quote")).toHaveText("Supercalifragilistic");
  await expectThreadAnswered(page, "Why? Explain the reasoning behind the quoted passage.");
  await expect(page.locator('#messages [data-role="user"]')).toHaveCount(1);
  expect(sessionPath(page)).not.toBe(rootPath);

  // It never becomes a session of its own in the list; its session's row stays the current one.
  await expect(page.locator("#sessions .session-sidebar-entry")).toHaveCount(1);
  await expect(page.locator("#sessions .session-sidebar-entry.current")).toHaveCount(1);
  await expect(page.locator("#sessions .session-sidebar-child-sessions")).toHaveCount(0);
  await expect(page.locator("#threadTreeBtn .thread-tree-count")).toHaveText("1");
  expect(await threadSessions()).toHaveLength(1);

  // The conversation it inherited is one click away, above the thread.
  await header(page).getByRole("button", { name: "Show earlier context (2 messages)" }).click();
  await expect(page.locator('#messages [data-role="user"]')).toHaveCount(2);
  await expect(page.locator('#messages [data-role="user"]').first()).toContainText("Reply with exactly the word Supercalifragilistic");

  // Browser Back returns to the reply the thread hangs from.
  await page.goBack();
  await expect(header(page)).toHaveCount(0);
  await expect.poll(() => sessionPath(page)).toBe(rootPath);
  const pill = page.locator(".thread-pill");
  await expect(pill).toContainText("1 thread");
  await expect(page.locator(".msg-flash")).toContainText("Supercalifragilistic");
  // The quoted passage is tinted in place in the reply.
  await expect.poll(() => page.evaluate(() => [...(CSS.highlights.get("thread-quote") ?? [])].map((range) => range.toString()))).toEqual(["Supercalifragilistic"]);

  // The reply lists its threads; a row opens the thread again.
  await pill.click();
  const row = page.locator(".thread-row-open");
  await expect(row.locator(".thread-row-label")).toHaveText("Why?");
  await expect(row.locator(".thread-row-quote")).toHaveText("“Supercalifragilistic”");
  await row.click();
  await expect(crumbs(page)).toHaveText(["Supercalifragilistic", "Why?"]);
  await expectThreadAnswered(page, "Why? Explain the reasoning");

  // Threads nest: a question inside the thread hangs from the thread.
  await selectReplyText(page, "Supercalifragilistic");
  await ask(page, "How?");
  await expect(crumbs(page)).toHaveText(["Supercalifragilistic", "Why?", "How?"]);
  await expectThreadAnswered(page, "How does this work?");
  await expect(page.locator("#sessions .session-sidebar-entry")).toHaveCount(1);

  // The tree shows the whole family and opens any node.
  await page.locator("#threadTreeBtn").click();
  const nodes = page.locator(".thread-node");
  await expect(nodes).toHaveCount(3);
  await expect(page.locator(".thread-node.current .thread-node-label")).toHaveText("How?");
  await expect(page.locator(".thread-node.root .thread-node-label")).toHaveText("Supercalifragilistic");
  await page.locator(".thread-node.root").click();
  await expect(page.locator("#overlay")).not.toHaveClass(/\bopen\b/);
  await expect(header(page)).toHaveCount(0);
  await expect.poll(() => sessionPath(page)).toBe(rootPath);
  await expect(page.locator(".thread-pill")).toContainText("1 thread");

  // The tree closes from its own button, without navigating.
  await page.locator("#threadTreeBtn").click();
  await page.getByRole("button", { name: "Close thread tree" }).click();
  await expect(page.locator("#overlay")).not.toHaveClass(/\bopen\b/);
  await expect.poll(() => sessionPath(page)).toBe(rootPath);

  // A breadcrumb leads back up from inside a thread.
  await page.locator("#threadTreeBtn").click();
  await page.locator(".thread-node", { hasText: "How?" }).click();
  await expect(crumbs(page)).toHaveText(["Supercalifragilistic", "Why?", "How?"]);
  await crumbs(page).filter({ hasText: "Why?" }).click();
  await expect(crumbs(page)).toHaveText(["Supercalifragilistic", "Why?"]);
  await expect(page.locator(".thread-pill")).toContainText("1 thread");
});

test("Other… drafts a thread that is created on send, and deleting a thread removes what hangs from it", async ({ page }) => {
  await login(page);
  await sendPrompt(page, "Reply with exactly the word Supercalifragilistic");
  const rootPath = sessionPath(page);

  // A draft exists only in the browser until its question is sent.
  await selectReplyText(page, "Supercalifragilistic");
  await ask(page, "Other…");
  await expect(header(page)).toHaveClass(/\bdraft\b/);
  await expect(header(page).locator(".thread-quote")).toHaveText("Supercalifragilistic");
  await expect(page.locator("#input")).toHaveAttribute("placeholder", "Ask about the quoted passage…");
  await expect(page.locator("#input")).toBeFocused();
  expect(await threadSessions()).toHaveLength(0);
  await header(page).getByRole("button", { name: "Cancel" }).click();
  await expect(header(page)).toHaveCount(0);
  await expect(page.locator('#messages [data-role="user"]')).toHaveCount(1);
  expect(await threadSessions()).toHaveLength(0);
  expect(sessionPath(page)).toBe(rootPath);

  await selectReplyText(page, "Supercalifragilistic");
  await ask(page, "Other…");
  await page.fill("#input", "Is this word spelled correctly?");
  await page.click("#sendBtn");
  await expect(crumbs(page)).toHaveText(["Supercalifragilistic", "Is this word spelled correctly?"]);
  await expect(header(page)).not.toHaveClass(/\bdraft\b/);
  await expectThreadAnswered(page, "Is this word spelled correctly?");
  await expect(page.locator("#input")).toHaveValue("");

  // Hang a second thread from the first, then delete the first from the reply's row.
  await selectReplyText(page, "Supercalifragilistic");
  await ask(page, "What?");
  await expect(crumbs(page)).toHaveCount(3);
  await expectThreadAnswered(page, "What does the quoted passage mean?");
  expect(await threadSessions()).toHaveLength(2);

  await crumbs(page).first().click();
  await expect(header(page)).toHaveCount(0);
  await page.locator(".thread-pill").click();
  await page.locator(".thread-row").hover();
  await page.getByRole("button", { name: "Delete thread: Is this word spelled correctly?" }).click();
  await expect(page.locator("#mTitle")).toContainText("Delete thread “Is this word spelled correctly?");
  await expect(page.locator("#mBody")).toContainText("1 nested thread will be deleted with it");
  await page.locator("#overlay.open").getByRole("button", { name: "Yes", exact: true }).click();

  await expect(page.locator(".thread-pill")).toHaveCount(0);
  await expect(page.locator("#threadTreeBtn")).toHaveCount(0);
  await expect.poll(async () => (await threadSessions()).length).toBe(0);
  const remaining = (await api("GET", "/sessions?all=1")).json.sessions;
  expect(remaining).toHaveLength(1);
  await expect(page.locator("#sessions .session-sidebar-entry")).toHaveCount(1);
});

test("a Claude Code session forks from its end into a thread", async ({ page }) => {
  await login(page);
  const opened = page.waitForResponse((response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/open-session");
  await page.locator("#newSessionHere").click();
  await page.locator('.session-harness-popover button:has([data-harness="claude-code"])').click();
  const { runner } = await (await opened).json();
  expect(runner.harness).toBe("claude-code");
  // The mock CLI needs no login; dismiss the credential prompt a new Claude Code session raises.
  await expect(page.locator("#mTitle")).toHaveText("Credentials");
  await page.locator("#mActions").getByRole("button", { name: "Close", exact: true }).click();

  await sendPrompt(page, "CLAUDE-THREAD-ROOT explain the cache");
  await expect(page.locator(REPLY_TEXT).last()).toContainText("Mock Claude persisted: CLAUDE-THREAD-ROOT explain the cache");
  // The reply becomes quotable once Claude's own transcript has been mirrored into the session store.
  await expect.poll(async () => {
    const current = (await api("GET", "/runners")).json.runners.find((candidate) => candidate.id === runner.id);
    if (!current?.sessionKey) return 0;
    return (await api("GET", `/session-entries?key=${encodeURIComponent(current.sessionKey)}`)).json.entries?.length ?? 0;
  }, { timeout: 30000 }).toBe(2);

  await selectReplyText(page, "explain the cache");
  await ask(page, "What?");
  await expect(header(page).locator(".thread-quote")).toHaveText("explain the cache");
  await expect(crumbs(page).last()).toHaveText("What?");
  // The fork carries the conversation: the mock echoes the thread's question back.
  await expect(page.locator(REPLY_TEXT).last()).toContainText("What does the quoted passage mean?");
  await agentIdle(page);

  // The thread's own session is listed once Claude's transcript for it has been mirrored.
  await expect.poll(async () => (await threadSessions()).length, { timeout: 30000 }).toBe(1);
  const threads = await threadSessions();
  const threadRunner = (await api("GET", "/runners")).json.runners.find((candidate) => candidate.thread?.id === threads[0].thread.id);
  expect(threadRunner.harness).toBe("claude-code");
  expect(threadRunner.thread.rootSessionKey).toBe(threads[0].thread.rootSessionKey);

  // Its own transcript starts at the fork; the copied conversation is the earlier context.
  await expect(page.locator('#messages [data-role="user"]')).toHaveCount(1);
  await header(page).getByRole("button", { name: "Show earlier context (2 messages)" }).click();
  await expect(page.locator('#messages [data-role="user"]').first()).toContainText("CLAUDE-THREAD-ROOT explain the cache");
  await expect(page.locator("#sessions .session-sidebar-entry.current .harness-pill")).toHaveText("Claude Code");
});
