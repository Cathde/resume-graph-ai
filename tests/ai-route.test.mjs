import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "../app/api/ai/route.ts";

test("AI proxy rejects missing credentials", async () => {
  const response = await POST(new Request("http://localhost/api/ai", {
    method: "POST",
    body: JSON.stringify({ model: "deepseek-v4-flash", prompt: "test", mode: "analyze" }),
  }));
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /API Key/);
});

test("AI proxy uses the selected fixed endpoint and never returns the key", async () => {
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
      body: JSON.stringify({ provider: "deepseek", apiKey: "sk-private-test", model: "deepseek-chat", mode: "test" }),
    }));
    assert.equal(response.status, 200);
    assert.equal(calledUrl, "https://api.deepseek.com/chat/completions");
    assert.equal(authorization, "Bearer sk-private-test");
    assert.doesNotMatch(await response.text(), /sk-private-test/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("AI proxy accepts a public HTTPS custom endpoint and rejects local targets", async () => {
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  globalThis.fetch = async (url) => {
    calledUrl = String(url);
    return Response.json({ choices: [{ message: { content: "{\"ok\":true}" } }] });
  };
  try {
    const accepted = await POST(new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ provider: "custom", endpoint: "https://models.example.com/v1/chat/completions", apiKey: "custom-key", model: "example-model", mode: "test" }),
    }));
    assert.equal(accepted.status, 200);
    assert.equal(calledUrl, "https://models.example.com/v1/chat/completions");

    const rejected = await POST(new Request("http://localhost/api/ai", {
      method: "POST",
      body: JSON.stringify({ provider: "custom", endpoint: "https://127.0.0.1/v1/chat/completions", apiKey: "custom-key", model: "example-model", mode: "test" }),
    }));
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /公开访问/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
