import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";

/** Detached Node+tsx child — PID is the node process, not a shell. */
export function spawnDetachedScript(scriptRel: string): ChildProcess {
  const root = process.cwd();
  const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
  const script = path.join(root, scriptRel);
  const child = spawn(process.execPath, [tsxCli, script], {
    cwd: root,
    detached: true,
    stdio: "ignore",
    shell: false,
    env: { ...process.env },
  });
  child.unref();
  return child;
}
