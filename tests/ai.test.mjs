import assert from "node:assert/strict";
import test from "node:test";
import { buildDeepSeekPrompt, parseDeepSeekAnalysis } from "../app/ai.ts";

const parent = {
  id: "parent", name: "通用版", extractedText: "邮箱 user@example.com 手机 13812345678\n实习经历\n内容运营",
};
const child = {
  id: "child", name: "增长版", extractedText: "邮箱 user@example.com 手机 13812345678\n实习经历\n增长运营",
};
const report = {
  items: [{ id: "change-1", kind: "modified", section: "实习经历", before: "内容运营", after: "增长运营" }],
};
const job = { company: "示例公司", role: "增长运营", jdText: "负责用户增长与内容策略" };

test("DeepSeek prompt hides common contacts and requests strict JSON", () => {
  const prompt = buildDeepSeekPrompt(parent, child, report, job, true);
  assert.doesNotMatch(prompt, /user@example\.com|13812345678/);
  assert.match(prompt, /JSON/);
  assert.match(prompt, /change-1/);
  assert.match(prompt, /示例公司/);
});

test("DeepSeek response must cover every known difference exactly once", () => {
  const valid = JSON.stringify({ items: [{
    diffItemId: "change-1", intent: "突出增长", jdRequirement: "用户增长",
    recommendation: "建议保留", reusableFor: ["增长运营"], confidence: 0.86,
  }] });
  assert.equal(parseDeepSeekAnalysis(valid, report)[0].confidence, 0.86);
  assert.throws(() => parseDeepSeekAnalysis('{"items":[]}', report), /未覆盖全部/);
  assert.throws(() => parseDeepSeekAnalysis('{"items":[{"diffItemId":"unknown"}]}', report), /无法对应或重复/);
});
