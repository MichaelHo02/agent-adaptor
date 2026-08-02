import assert from "node:assert/strict";
import test from "node:test";

import { confirmClipboardAccess } from "../src/clipboard-confirmation.js";

test("clipboard access requires explicit confirmation", () => {
  assert.doesNotThrow(() => confirmClipboardAccess(() => ({ status: 0 })));
  assert.throws(() => confirmClipboardAccess(() => ({ status: 1 })), /cancelled/);
});
