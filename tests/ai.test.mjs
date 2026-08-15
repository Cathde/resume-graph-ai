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
  assert.match(prompt, /overallMatch|requirements|actions|do_not_force/);
});

test("DeepSeek response includes overall fit, coverage, change evaluation and actions", () => {
  const valid = JSON.stringify({
    overallMatch: { scoreMin: 62, scoreMax: 74, evidenceSufficiency: "medium", summary: "方向相关但增长结果证据不足", reasons: ["有内容运营经验"] },
    requirements: [{ requirement: "用户增长", priority: "core", status: "partial", evidence: ["内容运营"], reason: "有相关经历但缺少转化结果" }],
    items: [{
      diffItemId: "change-1", intent: "突出增长", jdRequirement: "用户增长", evaluation: "partially_effective", evidence: "仅更换岗位表述",
      recommendation: "补充真实增长结果后保留", reusableFor: ["增长运营"], confidence: 0.86,
    }],
    actions: [
      { priority: "high", type: "revise", action: "补充转化指标", rationale: "现有经历可以提供证据" },
      { priority: "high", type: "do_not_force", action: "不要虚构海外增长", rationale: "简历没有对应经历" },
    ],
  });
  const parsed = parseDeepSeekAnalysis(valid, report);
  assert.deepEqual([parsed.overallMatch.scoreMin, parsed.overallMatch.scoreMax], [62, 74]);
  assert.equal(parsed.requirements[0].status, "partial");
  assert.equal(parsed.items[0].evaluation, "partially_effective");
  assert.equal(parsed.actions[1].type, "do_not_force");
});

test("DeepSeek response rejects incomplete or inconsistent analysis", () => {
  const base = {
    overallMatch: { scoreMin: 62, scoreMax: 74, evidenceSufficiency: "medium", summary: "匹配一般", reasons: [] },
    requirements: [{ requirement: "增长", priority: "core", status: "partial", evidence: [], reason: "证据不足" }],
    items: [],
    actions: [{ priority: "high", type: "revise", action: "补充结果", rationale: "增强证据" }],
  };
  assert.throws(() => parseDeepSeekAnalysis(JSON.stringify(base), report), /未覆盖全部/);
  assert.throws(() => parseDeepSeekAnalysis(JSON.stringify({ ...base, overallMatch: { ...base.overallMatch, scoreMin: 90, scoreMax: 60 } }), report), /匹配区间无效/);
  assert.throws(() => parseDeepSeekAnalysis(JSON.stringify({ ...base, items: [{ diffItemId: "unknown" }] }), report), /无法对应或重复/);
});
