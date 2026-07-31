import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = (path) => readFileSync(new URL(`../public/src/components/${path}`, import.meta.url), "utf8");
const markup = (source) => source.slice(source.indexOf("</script>") + "</script>".length);

test("message action business rules are named outside AssistantMessage markup", () => {
  const source = component("transcript/AssistantMessage.svelte");
  assert.match(source, /function partActions\(block, index\)/);
  assert.match(source, /\{@const actions = partActions\(block, index\)\}/);
  assert.doesNotMatch(source, /copyText=\{block\.type === "text" \?/);
  assert.doesNotMatch(source, /restore=\{index === displayBlocks\.length - 1 \?/);
});

test("pinned widget markup delegates compound display rules to named helpers", () => {
  const source = component("PinnedWidgetGrid.svelte");
  assert.match(source, /title=\{widgetTitle\(widget\)\}/);
  assert.match(source, /\{#if readyMedia\(widget, "image"\)\}/);
  assert.match(source, /class:touch-drop-target=\{isSectionTouchTarget\(section\)\}/);
  assert.doesNotMatch(source, /title=\{`\$\{widget\.label\}\$\{widget\.availability/);
  assert.doesNotMatch(source, /class:touch-drop-target=\{touchDestination\?\.scope === section\.scope/);
});

test("session, credential, and tool labels do not encode branching rules in markup", () => {
  const sessions = component("SessionPickerModal.svelte");
  const credentials = component("CredentialsModal.svelte");
  const tools = component("transcript/ToolCard.svelte");

  assert.match(sessions, /class=\{sessionRowClass\(current, timelineStatus\)\}/);
  assert.match(sessions, /\{plural\(family\.forks\.length, "iteration"\)\}/);
  assert.doesNotMatch(sessions, /class=\{`m-option session-row\$\{current \?/);
  assert.doesNotMatch(sessions, /family\.forks\.length === 1 \? "" : "s"/);

  assert.match(credentials, /\{cancelledFlowMessage\(\$credentialsState\.flow\)\}/);
  assert.match(credentials, /\{apiKeyActionLabel\(selected\)\}/);
  assert.doesNotMatch(markup(credentials), /failureCode === "oauth_flow_expired" \?/);
  assert.doesNotMatch(markup(credentials), /selected\?\.credentialType === "api_key" \?/);

  assert.match(tools, /const statusText = \$derived\(card\.status/);
  assert.match(tools, /const statusClass = \$derived\(card\.status/);
  assert.doesNotMatch(markup(tools), /card\.status === "running" \?/);
});
