import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = (name) => readFileSync(new URL(`../public/src/components/${name}`, import.meta.url), "utf8");

test("single-field workflows use native form submission instead of Enter key handlers", () => {
  const auth = component("AuthGate.svelte");
  assert.match(auth, /<form class="card" onsubmit=\{submit\} aria-busy=\{connecting\}>/);
  assert.match(auth, /<label[^>]*for="gateInput">Authentication token<\/label>/);
  assert.match(auth, /id="gateBtn" type="submit"/);
  assert.doesNotMatch(auth, /onkeydown=\{onKeydown\}/);

  const prompt = component("TextPromptModal.svelte");
  assert.match(prompt, /<form onsubmit=\{submitTextPrompt\}>/);
  assert.match(prompt, /placeholder = \$derived\(String\(\$textPrompt\.placeholder \?\? ""\)\.trim\(\)\)/);
  assert.match(prompt, /inputLabel = \$derived\(placeholder \|\| String\(\$textPrompt\.title \?\? ""\)\.trim\(\) \|\| "Response"\)/);
  assert.match(prompt, /aria-label=\{inputLabel\}/);
  assert.match(prompt, /placeholder=\{placeholder\}/);
  assert.match(prompt, /<button class="[^"]*\bbtn\b[^"]*" type="submit"/);
  assert.doesNotMatch(prompt, /event\.key === "Enter"/);

  const folder = component("FolderBrowserModal.svelte");
  assert.match(folder, /<form class="newdir-row"[^>]*onsubmit=\{submitCreateFolder\}>/);
  assert.match(folder, /<label for="newFolderName">New folder name<\/label>/);
  assert.match(folder, /id="newFolderName"[\s\S]*required/);
});

test("message, widget, and routine entry expose labels and native submit controls", () => {
  const composer = component("Composer.svelte");
  assert.match(composer, /<form class="inner" onsubmit=/);
  assert.match(composer, /id="input"\s+aria-label="Message"/);
  assert.match(composer, /id="sendBtn" type="submit"/);

  const hublot = component("HublotManagerModal.svelte");
  assert.match(hublot, /<label for="hublotDescription">/);
  assert.match(hublot, /id="hublotDescription"[\s\S]*required/);
  assert.match(hublot, /<button class="btn" type="submit"/);

  const routine = component("RoutineManagerModal.svelte");
  assert.match(routine, /<label for="routineBrief"/);
  assert.match(routine, /id="routineBrief"[\s\S]*required/);
  assert.match(routine, /<button[^>]*class="[^"]*\bbtn\b[^"]*"[^>]*type="submit"/);
});

test("search and constrained credential entry use semantic field types and native validation", () => {
  const picker = component("SessionPickerModal.svelte");
  assert.match(picker, /<form class="search-row" role="search" onsubmit=/);
  assert.match(picker, /type="search"\s+aria-label="Search sessions"/);
  assert.match(picker, /<select aria-label="Search scope"/);

  const cloud = component("CloudWorkspaceModal.svelte");
  assert.match(cloud, /<form class="cloud-connect-action" onsubmit=/);
  assert.match(cloud, /inputmode="numeric" pattern="\[0-9\]\{12\}"/);
  assert.match(cloud, /<button class="btn cloud-primary" type="submit" disabled=\{loading\}>/);

  const credentials = component("CredentialsModal.svelte");
  assert.match(credentials, /<select bind:value=\{selectedProvider\}[^>]*required/);
  assert.match(credentials, /type="password"[\s\S]*?placeholder="Enter a new API key"[\s\S]*?required/);

  const auth = component("AuthGate.svelte");
  assert.match(auth, /aria-invalid=\{errorMessage \? "true" : undefined\}/);
  assert.match(auth, /aria-describedby=\{inputDescription\}/);
  assert.match(auth, /id="gateError" role="alert" aria-atomic="true"/);
});

test("workspace forms pair native constraints with actionable validation guidance", () => {
  const llmbox = component("LlmboxWorkspaceModal.svelte");
  assert.match(llmbox, /<form id="llmboxWorkspaceForm" class="llmbox-form"[^>]*onsubmit=\{createWorkspace\}>/);
  assert.match(llmbox, /required pattern="\[a-z0-9\].*?"[^>]*title="Use 1–63 lowercase letters, numbers, or hyphens"/);
  assert.match(llmbox, /type="number" min="1" max=\{MAX_DISK_GIB\} step="1"/);
  assert.match(llmbox, /class="llmbox-error" role="alert" aria-atomic="true"/);

  const cloud = component("CloudWorkspaceModal.svelte");
  assert.match(cloud, /class="cloud-required-hint wide">All fields are required\. If anything is missing, selecting Provision will highlight it\./);
  assert.match(cloud, /field\.type === "textarea"[\s\S]*?<textarea[^>]*required=\{field\.required\}/);
  assert.match(cloud, /class="btn cloud-primary" type="submit" disabled=\{loading\}>\{loading \? "Verifying access…"/);
  assert.doesNotMatch(cloud, /credentialsComplete/);
  assert.match(cloud, /class="cloud-error" role="alert"/);
});

test("file editing and checkpoint selection submit through forms while preserving shortcuts", () => {
  const explorer = component("FileExplorerModal.svelte");
  assert.match(explorer, /<form id="fileEditorForm" class="file-editor-form" aria-busy=\{\$fileExplorer\.saving\} onsubmit=\{submitFileEditor\}>/);
  assert.match(explorer, /event\.isComposing/);
  assert.match(explorer, /\|\| \$fileExplorer\.saving/);
  assert.match(explorer, /aria-keyshortcuts="Control\+S Meta\+S"/);
  assert.match(explorer, /event\.currentTarget\.form\?\.requestSubmit\(\)/);
  assert.match(explorer, /type="submit" form="fileEditorForm"/);
  assert.match(explorer, /saveError[\s\S]*?role="alert"/);

  const checkpoint = component("CheckpointModelPickerModal.svelte");
  assert.match(checkpoint, /<form[^>]*onsubmit=/);
  assert.match(checkpoint, /<label for="checkpointSummaryModel">Checkpoint summary model<\/label>/);
  assert.match(checkpoint, /id="checkpointSummaryModel"/);
  assert.match(checkpoint, /class="[^"]*\bbtn\b[^"]*" type="submit"/);
});
