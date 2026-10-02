import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ProbeResult {
  durationMs: bigint;
  codec: string;
  sampleRate: number | null;
  channels: number | null;
}

interface FFProbeOutput {
  format?: { duration?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    sample_rate?: string;
    channels?: number;
    duration?: string;
  }>;
}

export async function probeAudio(filePath: string): Promise<ProbeResult> {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration:stream=codec_type,codec_name,sample_rate,channels,duration",
      "-of",
      "json",
      filePath,
    ],
    { timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
  );
  const parsed = JSON.parse(stdout) as FFProbeOutput;
  const stream = parsed.streams?.find((item) => item.codec_type === "audio");
  if (!stream) throw new Error("NO_AUDIO_STREAM");
  const durationSeconds = Number(parsed.format?.duration ?? stream.duration ?? 0);
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) throw new Error("INVALID_DURATION");
  return {
    durationMs: BigInt(Math.round(durationSeconds * 1000)),
    codec: stream.codec_name ?? "unknown",
    sampleRate: stream.sample_rate ? Number(stream.sample_rate) : null,
    channels: stream.channels ?? null,
  };
}

export async function generatePeaks(filePath: string, bucketCount = 1600): Promise<number[]> {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      "ffmpeg",
      ["-hide_banner", "-loglevel", "error", "-i", filePath, "-vn", "-ac", "1", "-ar", "100", "-f", "s16le", "pipe:1"],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString().slice(0, 2000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `ffmpeg exited with ${code}`));
    });
  });

  const samples = Buffer.concat(chunks);
  const sampleCount = Math.floor(samples.length / 2);
  if (sampleCount === 0) throw new Error("EMPTY_PCM");
  const actualBuckets = Math.min(bucketCount, sampleCount);
  const bucketSize = Math.max(1, Math.ceil(sampleCount / actualBuckets));
  const result: number[] = [];
  for (let bucket = 0; bucket < actualBuckets; bucket += 1) {
    const start = bucket * bucketSize;
    const end = Math.min(sampleCount, start + bucketSize);
    let max = 0;
    for (let index = start; index < end; index += 1) {
      const value = Math.abs(samples.readInt16LE(index * 2));
      if (value > max) max = value;
    }
    result.push(Number((max / 32768).toFixed(4)));
  }
  return result;
}
