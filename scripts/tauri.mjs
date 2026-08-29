import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cargoBin = join(homedir(), ".cargo", "bin");
const sep = process.platform === "win32" ? ";" : ":";
process.env.PATH = `${cargoBin}${sep}${process.env.PATH ?? ""}`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(root, "node_modules", ".bin");

// bun installs `tauri.exe` on Windows; npm/pnpm install `tauri.cmd`.
const candidates =
  process.platform === "win32" ? ["tauri.exe", "tauri.cmd"] : ["tauri"];
const tauriBin =
  candidates.map((name) => join(binDir, name)).find(existsSync) ??
  join(binDir, candidates[0]);

const args = process.argv.slice(2);
const child = spawn(tauriBin, args, {
  stdio: "inherit",
  env: process.env,
  // .cmd shims can only be run through a shell; a real .exe must not be,
  // or paths with spaces would break.
  shell: tauriBin.endsWith(".cmd"),
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
