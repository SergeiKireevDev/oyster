import { pipeline, env } from "@huggingface/transformers";

// Cache model files in the browser and never look for a server-side model copy.
env.allowLocalModels = false;
env.useBrowserCache = true;

let transcriberPromise;

function transcriber() {
  if (!transcriberPromise) {
    transcriberPromise = pipeline(
      "automatic-speech-recognition",
      "onnx-community/whisper-base.en",
      {
        dtype: "q8",
        progress_callback: (data) => self.postMessage({ type: "progress", data }),
      },
    );
  }
  return transcriberPromise;
}

self.onmessage = async ({ data }) => {
  if (data?.type !== "transcribe") return;
  try {
    const recognize = await transcriber();
    self.postMessage({ type: "status", status: "Transcribing…" });
    const result = await recognize(new Float32Array(data.audio), {
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    self.postMessage({ type: "result", id: data.id, text: result?.text ?? "" });
  } catch (error) {
    transcriberPromise = null;
    self.postMessage({ type: "error", id: data.id, message: error?.message ?? String(error) });
  }
};
