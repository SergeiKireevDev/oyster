import { test, expect } from "@playwright/test";
import { login } from "./lib/harness.js";
import { ensureContainer, teardownContainer } from "./lib/reset.js";

test.beforeEach(async () => { await ensureContainer(); });
test.afterEach(() => { teardownContainer(); });

test("voice dictation shows a waveform while speech is detected", async ({ page }) => {
  await page.addInitScript(() => {
    class MockSpeechRecognition {
      constructor() { window.__speechRecognition = this; }
      start() { this.onstart?.(); }
      stop() { this.onend?.(); }
      abort() { this.onend?.(); }
    }
    window.SpeechRecognition = MockSpeechRecognition;
  });

  await login(page);
  const input = page.locator("#input");
  const voice = page.locator("#voiceBtn");
  await input.fill("Please");
  await voice.click();
  await expect(voice).toHaveAttribute("aria-pressed", "true");

  await page.evaluate(() => window.__speechRecognition.onspeechstart());
  await expect(voice.locator(".voice-waveform")).toBeVisible();
  await expect(voice).toHaveClass(/speaking/);

  await page.evaluate(() => {
    const results = [[{ transcript: "write the tests" }]];
    window.__speechRecognition.onresult({ results });
  });
  await expect(input).toHaveValue("Please write the tests");

  await page.evaluate(() => window.__speechRecognition.onspeechend());
  await expect(voice.locator(".voice-waveform")).toHaveCount(0);
  await expect(voice).not.toHaveClass(/speaking/);

  await voice.click();
  await expect(voice).toHaveAttribute("aria-pressed", "false");
});

test("Brave records audio and inserts local Whisper transcription", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "brave", { value: { isBrave: async () => true } });
    Object.defineProperty(navigator, "mediaDevices", {
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });

    class MockMediaRecorder {
      constructor() { this.state = "inactive"; this.mimeType = "audio/webm"; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["recorded audio"]) });
        this.onstop?.();
      }
    }
    class MockAudioContext {
      async resume() {}
      createAnalyser() {
        return { fftSize: 0, getByteTimeDomainData(samples) { samples.fill(142); } };
      }
      createMediaStreamSource() { return { connect() {} }; }
      async decodeAudioData() {
        return { numberOfChannels: 1, length: 160, sampleRate: 16000, getChannelData: () => new Float32Array(160) };
      }
      async close() {}
    }
    class MockWhisperWorker {
      postMessage(message) {
        setTimeout(() => this.onmessage?.({ data: { type: "progress", data: { progress: 50 } } }), 10);
        setTimeout(() => this.onmessage?.({ data: { type: "result", id: message.id, text: "local whisper works" } }), 80);
      }
      terminate() {}
    }
    window.MediaRecorder = MockMediaRecorder;
    window.AudioContext = MockAudioContext;
    window.Worker = MockWhisperWorker;
  });

  await login(page);
  const input = page.locator("#input");
  const voice = page.locator("#voiceBtn");
  await input.fill("Brave");
  await voice.click();
  await expect(voice).toHaveAttribute("aria-pressed", "true");
  await expect(voice.locator(".voice-waveform")).toBeVisible();

  await voice.click();
  await expect(page.locator("#voiceStatus")).toContainText(/Preparing audio|Loading Whisper|Downloading Whisper/);
  await expect(input).toHaveValue("Brave local whisper works");
  await expect(voice).toBeEnabled();
});
