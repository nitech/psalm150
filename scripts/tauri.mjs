import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cargoBin = join(homedir(), ".cargo", "bin");
const sep = process.platform === "win32" ? ";" : ":";
process.env.PATH = `${cargoBin}${sep}${process.env.PATH ?? ""}`;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriBin =
  process.platform === "win32"
    ? join(root, "node_modules", ".bin", "tauri.cmd")
    : join(root, "node_modules", ".bin", "tauri");

const args = process.argv.slice(2);
const child = spawn(tauriBin, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
