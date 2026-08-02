import assert from "node:assert/strict";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveCheckout } from "../src/checkout.js";

test("resolveCheckout accepts directories and rejects missing paths", async () => {
  const directory = await mkdtemp(join(tmpdir(), "agent-adaptor-"));
  try {
    assert.equal(await resolveCheckout(directory), await realpath(directory));
    await assert.rejects(resolveCheckout(join(directory, "missing")), /does not exist/);
  } finally {
    await rm(directory, { recursive: true });
  }
});
