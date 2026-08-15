import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/ai/route.ts";

test("AI proxy rejects missing credentials without calling DeepSeek", async () => {
  const response = await POST(new Request("http://localhost/api/ai", {
    method: "POST",
    body: JSON.stringify({ model: "deepseek-v4-flash", prompt: "test", mode: "analyze" }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /API Key/);
});

test("AI proxy uses the fixed DeepSeek endpoint and never returns the key", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let authorization = "";
  globalThis.fetch = async (url, options) => {
    calledUrl = String(url);
    authorization = String(options?.headers?.Authorization ?? "");
    return Response.json({ model: "deepseek-v4-flash", choices: [{ message: { content: "{\"ok\":true}" } }], usage: { total_tokens: 2 } });
  };
  try {
    const response = await POST(new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ apiKey: "sk-private-test", model: "deepseek-v4-flash", mode: "test" }),
    }));
    assert.equal(response.status, 200);
    assert.equal(calledUrl, "https://api.deepseek.com/chat/completions");
    assert.equal(authorization, "Bearer sk-private-test");
    assert.doesNotMatch(await response.text(), /sk-private-test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

