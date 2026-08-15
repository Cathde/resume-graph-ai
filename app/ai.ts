import { anonymizeMaterial } from "./model.ts";
import type { AiAnalysisItem, DiffReport, Job, ResumeNode } from "./model.ts";

export type AiSettings = {
  apiKey: string;
  model: string;
  remember: boolean;
  anonymize: boolean;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  apiKey: "",
  model: "deepseek-v4-flash",
  remember: false,
  anonymize: true,
};

export const AI_SETTINGS_KEY = "resume-graph-deepseek-settings";

export function buildDeepSeekPrompt(parent: ResumeNode, child: ResumeNode, report: DiffReport, job: Job, anonymize: boolean) {
  const changes = report.items.map((item) => ({
    diffItemId: item.id,
    type: item.kind,
    section: item.section,
    before: item.before,
    after: item.after,
  }));
  const prompt = `请分析一份针对具体岗位修改的简历。只依据提供的真实内容判断，不得补写、推断或虚构经历。

目标岗位：${job.company}｜${job.role}

岗位 JD：
${job.jdText || "未提供 JD 正文"}

父版本简历（${parent.name}）：
${parent.extractedText}

当前版本简历（${child.name}）：
${child.extractedText}

已确认的结构化差异：
${JSON.stringify(changes, null, 2)}

请返回 JSON 对象，格式必须严格如下：
{
  "items": [
    {
      "diffItemId": "必须来自上述差异",
      "intent": "这项修改可能想突出什么",
      "jdRequirement": "它对应 JD 中的哪项要求；无明确对应时如实说明",
      "recommendation": "是否建议保留，以及理由",
      "reusableFor": ["可复用的岗位类型"],
      "confidence": 0.8
    }
  ]
}

每个差异 ID 输出且只输出一次。confidence 必须是 0 到 1 之间的数字。不要输出 JSON 之外的文字。`;
  return anonymize ? anonymizeMaterial(prompt) : prompt;
}

export function parseDeepSeekAnalysis(input: string, report: DiffReport): AiAnalysisItem[] {
  const parsed = JSON.parse(input) as { items?: unknown } | unknown[];
  const rawItems = Array.isArray(parsed) ? parsed : parsed?.items;
  if (!Array.isArray(rawItems)) throw new Error("AI 返回结果缺少 items 数组");
  const validIds = new Set(report.items.map((item) => item.id));
  const seen = new Set<string>();
  const items = rawItems.map((raw) => {
    const item = raw as Record<string, unknown>;
    const diffItemId = String(item?.diffItemId ?? "");
    if (!validIds.has(diffItemId) || seen.has(diffItemId)) throw new Error("AI 返回了无法对应或重复的差异项");
    seen.add(diffItemId);
    return {
      diffItemId,
      intent: String(item.intent ?? ""),
      jdRequirement: String(item.jdRequirement ?? ""),
      recommendation: String(item.recommendation ?? ""),
      reusableFor: Array.isArray(item.reusableFor) ? item.reusableFor.map(String) : [],
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
    };
  });
  if (items.length !== report.items.length) throw new Error("AI 未覆盖全部差异项，请重试");
  return items;
}
