import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatWorkDuration, latestTranscriptWorkPeriod, messageTimestampMs } from "../public/src/lib/workDuration.js";

test("work duration formats seconds, minutes, and hours without overflowing units", () => {
  assert.equal(formatWorkDuration(0), "0 sec");
  assert.equal(formatWorkDuration(59_999), "59 sec");
  assert.equal(formatWorkDuration(60_000), "1 min 0 sec");
  assert.equal(formatWorkDuration(3_661_000), "1 hr 1 min 1 sec");
  assert.equal(formatWorkDuration(-1_000), "0 sec");
});

test("message timestamps accept agent milliseconds and persisted ISO values", () => {
  assert.equal(messageTimestampMs(1_234), 1_234);
  assert.equal(messageTimestampMs("2026-07-22T12:00:00.000Z"), Date.UTC(2026, 6, 22, 12));
  assert.ok(Number.isNaN(messageTimestampMs("invalid")));
});

test("latest work period freezes completed turns at the last rendered timestamp", () => {
  assert.deepEqual(latestTranscriptWorkPeriod([
    { kind: "user", timestamp: 1_000 },
    { kind: "assistant", timestamp: 4_000 },
    { kind: "user", timestamp: 10_000 },
    { kind: "assistant", timestamp: 15_000 },
  ]), { startedAt: 10_000, endedAt: 15_000 });
  assert.deepEqual(latestTranscriptWorkPeriod([{ kind: "user", timestamp: 2_000 }]), { startedAt: 2_000, endedAt: 2_000 });
});

test("work duration is rendered once after the transcript items for busy and idle sessions", () => {
  const source = readFileSync(new URL("../public/src/components/Transcript.svelte", import.meta.url), "utf8");
  const loopEnd = source.indexOf("{/each}");
  const label = source.indexOf('class="work-duration"');
  assert.ok(loopEnd >= 0 && label > loopEnd);
  assert.equal(source.match(/class="work-duration"/g)?.length, 1);
  assert.match(source, /\$appSession\.busy \? now : workPeriod\.endedAt/);
  assert.match(source, /{#if \$appSession\.busy}<span class="spin"/);
});
