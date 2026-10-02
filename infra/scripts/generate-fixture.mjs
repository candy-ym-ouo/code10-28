import { spawn } from "node:child_process";

const output = process.argv[2] ?? "tone-3s.wav";
const args = [
  "-hide_banner", "-loglevel", "error", "-f", "lavfi",
  "-i", "sine=frequency=440:duration=3", "-ac", "1", "-ar", "44100", output,
];
const child = spawn("ffmpeg", args, { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 1));
