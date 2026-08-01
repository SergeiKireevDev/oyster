import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../public/src/style.css", import.meta.url), "utf8");
const transcript = readFileSync(new URL("../public/src/components/Transcript.svelte", import.meta.url), "utf8");
const user = readFileSync(new URL("../public/src/components/transcript/UserMessage.svelte", import.meta.url), "utf8");
const assistant = readFileSync(new URL("../public/src/components/transcript/AssistantMessage.svelte", import.meta.url), "utf8");
const assistantActions = readFileSync(new URL("../public/src/components/transcript/AssistantPartActions.svelte", import.meta.url), "utf8");
const copyButton = readFileSync(new URL("../public/src/components/transcript/CopyMessageButton.svelte", import.meta.url), "utf8");
const activityStack = readFileSync(new URL("../public/src/components/transcript/ActivityStack.svelte", import.meta.url), "utf8");
const toolCard = readFileSync(new URL("../public/src/components/transcript/ToolCard.svelte", import.meta.url), "utf8");

test("message actions stay hidden until hover or focus selection", () => {
  assert.match(css, /\.permalink \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(copyButton, /\.message-copy \{[\s\S]*?opacity: 0;[\s\S]*?pointer-events: none;/);
  assert.match(css, /\.msg:hover > \.permalink[\s\S]*?opacity: \.85; pointer-events: auto;/);
  assert.match(css, /@media \(hover: hover\)[\s\S]*?\.user-message-row:hover \.msg\.user > \.permalink,[\s\S]*?\.user-message-row:hover \.msg\.user > \.message-copy[\s\S]*?pointer-events: auto;/);
  assert.match(user, /class="message-row user-message-row" data-role="user"/);
  assert.match(css, /@media \(hover: none\)[\s\S]*?\.msg:hover > \.permalink[\s\S]*?opacity: 0; pointer-events: none;[\s\S]*?\.msg:focus-within > \.permalink[\s\S]*?opacity: \.85; pointer-events: auto;/);
});

test("text assistant parts always own a clipboard control", () => {
  assert.match(assistant, /const isText = block\.type === "text";[\s\S]*?copy: isText/);
  assert.match(assistant, /copy=\{actions\.copy\}/);
  assert.match(assistantActions, /\{#if showCopy\}[\s\S]*?<CopyMessageButton/);
});

test("transcript uses spacious turns and a single borderless activity signal", () => {
  const transcriptGaps = [...transcript.matchAll(/\.transcript\s*\{[^}]*\bgap:\s*(\d+)px/g)].map((match) => Number(match[1]));
  assert.ok(transcriptGaps.length > 0);
  assert.deepEqual([...new Set(transcriptGaps)], [4]);
  assert.match(assistant, /\.assistant-entry \{[\s\S]*?gap: 4px;/);
  assert.match(assistant, /\.assistant-entry\.empty \{ display: none; \}/);
  assert.match(assistant, /const empty = \$derived\(displayBlocks\.length === 0 && !data\.errorMessage\)/);
  assert.match(assistant, /class:empty=\{empty\}/);
  assert.match(css, /#messages > \[data-role="user"\] \+ \.assistant-entry,[\s\S]*?margin-top: 12px;/);
  assert.match(transcript, /const turnActivityGroups = derived\(transcriptItems/);
  assert.match(transcript, /item\.kind === "user" \|\| item\.kind === "compaction"/);
  assert.match(transcript, /turnAnchorId \?\?= item\.id/);
  assert.match(transcript, /groups\.set\(turnAnchorId, turnActivities\)/);
  assert.match(transcript, /for \(let index = boundary \+ 1; index < items\.length; index\+\+\)/);
  assert.doesNotMatch(transcript, /items\.slice\(boundary \+ 1\)/);
  assert.match(transcript, /const isCurrentTurnActivity = \(item\) => \$appSession\.busy && item\.id === \$latestTurnActivityId/);
  assert.match(transcript, /\{@const activityCurrent = isCurrentTurnActivity\(item\)\}/);
  assert.match(transcript, /activityActive=\{activityCurrent\}/);
  assert.match(transcript, /activityBlocks=\{\$turnActivityGroups\.get\(item\.id\) \?\? \[\]\}/);
  assert.match(transcript, /activityKey=\{item\.id\}/);
  assert.match(transcript, /activityUnsettled=\{activityCurrent\}/);
  assert.match(assistant, /arrangeActivity\(data\.blocks, activityBlocks, activityKey\)/);
  assert.match(assistant, /visible\.push\(\{[\s\S]*?type: "activityStack"/);
  assert.match(assistant, /renderKey: `activity:\$\{identity\}`/);
  assert.match(assistant, /return block\.renderKey/);
  assert.match(activityStack, /let historyOpen = \$state\(false\)/);
  assert.match(activityStack, /class="activity-history" bind:open=\{historyOpen\}/);
  assert.doesNotMatch(assistant, /latestActivityIndex|insertionIndex|visible\.splice/);
  assert.match(activityStack, /const latestThinking = \$derived\(active \? thinkingBlocks\.at\(-1\) : null\)/);
  assert.match(activityStack, /const headBlock = \$derived\(active \? blocks\.at\(-1\) : null\)/);
  assert.match(activityStack, /const headTool = \$derived\(headBlock\?\.type === "toolCall" \? headBlock : null\)/);
  assert.match(activityStack, /block !== latestThinking && block !== headTool/);
  assert.match(activityStack, /class="activity-history"/);
  assert.ok(activityStack.indexOf('{#if pastBlocks.length}') < activityStack.indexOf('{#if latestThinking}'));
  assert.ok(activityStack.indexOf('{#if pastBlocks.length}') < activityStack.indexOf('{#if headTool}'));
  assert.match(toolCard, /class="block tool activity-step"/);
  assert.match(css, /details\.block\.activity-step \{[\s\S]*?border: 0;[\s\S]*?background: transparent;/);
  assert.match(css, /html\[data-theme="light"\] details\.block\.activity-step,[\s\S]*?background: transparent;/);
  assert.match(activityStack, /class:glowing=\{unsettled\}/);
  assert.match(activityStack, /\.current-thinking \.activity-indicator\.glowing \{[\s\S]*?box-shadow:[\s\S]*?animation:/);
  assert.match(activityStack, /\.activity-history-body \{[\s\S]*?border-left:/);
});

test("activity rows stay bounded by the transcript width", () => {
  assert.match(activityStack, /\.activity-stack \{[\s\S]*?width: 100%;[\s\S]*?max-width: 100%;[\s\S]*?min-width: 0;/);
  assert.match(activityStack, /\.activity-stack > details,[\s\S]*?\.activity-history-body \{[\s\S]*?min-width: 0;[\s\S]*?max-width: 100%;/);
  assert.match(css, /details\.block\.activity-step \{ min-width: 0; max-width: 100%; \}/);
});

test("touching a message selects it before its controls can be activated", () => {
  for (const source of [user, assistant]) {
    assert.match(source, /pointerType !== "touch"/);
    assert.match(source, /event\.preventDefault\(\)/);
    assert.match(source, /event\.currentTarget\.focus\(\{ preventScroll: true \}\)/);
    assert.match(source, /tabindex="-1"\s+onpointerdowncapture=\{selectOnFirstTouch\}/);
  }
});
