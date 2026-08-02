import { realpath, stat } from "node:fs/promises";

export async function resolveCheckout(cwd: string): Promise<string> {
  const resolved = await realpath(cwd).catch(() => undefined);
  if (!resolved || !(await stat(resolved)).isDirectory()) {
    throw new Error(`Checkout directory does not exist: ${cwd}`);
  }
  return resolved;
}
