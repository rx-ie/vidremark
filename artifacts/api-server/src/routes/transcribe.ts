import { Router } from "express";
import { spawn } from "child_process";
import { tmpdir } from "os";
import { join } from "path";
import { createReadStream, unlink } from "fs";
import { randomUUID } from "crypto";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

router.post("/transcribe", async (req, res) => {
  const { videoUrl } = req.body as { videoUrl?: string };

  if (!videoUrl || typeof videoUrl !== "string") {
    res.status(400).json({ error: "videoUrl is required" });
    return;
  }

  const tmpFile = join(tmpdir(), `parish-audio-${randomUUID()}.mp3`);

  try {
    await extractAudio(videoUrl, tmpFile);

    const audioStream = createReadStream(tmpFile);
    const transcription = await openai.audio.transcriptions.create({
      file: audioStream as unknown as File,
      model: "gpt-4o-mini-transcribe",
      response_format: "json",
    });

    unlink(tmpFile, () => {});

    res.json({ transcript: transcription.text });
  } catch (err) {
    unlink(tmpFile, () => {});
    const message = err instanceof Error ? err.message : "Transcription failed";
    res.status(500).json({ error: message });
  }
});

function extractAudio(videoUrl: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i", videoUrl,
      "-vn",
      "-ar", "16000",
      "-ac", "1",
      "-b:a", "32k",
      "-f", "mp3",
      outputPath,
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });

    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on("error", (err) => reject(err));
  });
}

export default router;
