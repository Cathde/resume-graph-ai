import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request("http://localhost/", { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("server-renders Resume Graph AI product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>Resume Graph AI/);
  assert.match(html, /岗位工作台/);
  assert.match(html, /简历谱系/);
  assert.match(html, /上传新简历/);
  assert.match(html, /只存当前浏览器/);
  assert.match(html, /AI 设置/);
  assert.match(html, /DeepSeek/);
  assert.doesNotMatch(html, /进一步解释修改依据|生成 AI 材料/);
  assert.doesNotMatch(html, /Building your site|codex-preview|react-loading-skeleton/);
});
