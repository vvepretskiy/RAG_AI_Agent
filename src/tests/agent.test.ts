import test from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "zlib";
import { __internal, askAgent } from "../agent";

test("askAgent throws when not initialized", async (t) => {
  __internal.resetForTests();
  t.after(() => {
    __internal.resetForTests();
  });

  await assert.rejects(async () => {
    await askAgent("hello");
  }, /Agent not initialized/);
});

test("askAgent decodes gz: question before invoke", async (t) => {
  __internal.resetForTests();
  const prevTimeout = process.env.TIMEOUT_RESPONSE;
  delete process.env.TIMEOUT_RESPONSE;

  let capturedQuery = "";
  const mockChain = {
    invoke: async ({ query }: { query: string }) => {
      capturedQuery = query;
      return { text: "ok" };
    },
  } as any;

  __internal.setQaChainForTests(mockChain);

  const plain = "what is in this document";
  const encoded = `gz:${gzipSync(plain).toString("base64")}`;
  const result = await askAgent(encoded);

  assert.equal(result, "ok");
  assert.equal(capturedQuery, plain);

  t.after(() => {
    if (prevTimeout === undefined) {
      delete process.env.TIMEOUT_RESPONSE;
    } else {
      process.env.TIMEOUT_RESPONSE = prevTimeout;
    }
    __internal.resetForTests();
  });
});

test("askAgent returns invoke timeout when chain does not finish", async (t) => {
  __internal.resetForTests();
  const prevTimeout = process.env.TIMEOUT_RESPONSE;
  process.env.TIMEOUT_RESPONSE = "5";

  const mockChain = {
    invoke: async (_input: unknown, _opts: unknown) =>
      new Promise<{ text: string }>(() => {
        // Intentional never-resolving promise to trigger timeout path.
      }),
  } as any;

  __internal.setQaChainForTests(mockChain);

  await assert.rejects(async () => {
    await askAgent("will timeout");
  }, /invoke timeout/);

  t.after(() => {
    if (prevTimeout === undefined) {
      delete process.env.TIMEOUT_RESPONSE;
    } else {
      process.env.TIMEOUT_RESPONSE = prevTimeout;
    }
    __internal.resetForTests();
  });
});
