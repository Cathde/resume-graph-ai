import { anonymizeMaterial } from "./model.ts";
import type { AiActionItem, AiAnalysis, AiAnalysisItem, AiRequirementMatch, DiffReport, Job, ResumeNode } from "./model.ts";

export type AiProviderId = "deepseek" | "openai" | "custom";

export type AiProvider = {
  id: AiProviderId;
  name: string;
  endpoint: string;
  defaultModel: string;
  description: string;
};

export const AI_PROVIDERS: AiProvider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    endpoint: "https://api.deepseek.com/chat/completions",
    defaultModel: "deepseek-chat",
    description: "DeepSeek 官方 OpenAI 兼容接口",
  },
  {
    id: "openai",
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    defaultModel: "gpt-4.1-mini",
    description: "OpenAI Chat Completions 接口",
  },
  {
    id: "custom",
    name: "自定义兼容接口",
    endpoint: "",
    defaultModel: "",
    description: "适用于提供 OpenAI Chat Completions 兼容接口的其他服务",
  },
];

export type AiSettings = {
  provider: AiProviderId;
  endpoint: string;
  apiKey: string;
  model: string;
  remember: boolean;
  anonymize: boolean;
};

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: "deepseek",
  endpoint: AI_PROVIDERS[0].endpoint,
  apiKey: "",
  model: AI_PROVIDERS[0].defaultModel,
  remember: false,
  anonymize: true,
};

export const AI_SETTINGS_KEY = "resume-graph-ai-settings-v2";
export const LEGACY_AI_SETTINGS_KEY = "resume-graph-deepseek-settings";

export function getAiProvider(provider: AiProviderId) {
  return AI_PROVIDERS.find((item) => item.id === provider) ?? AI_PROVIDERS[0];
}

export function normalizeAiSettings(saved: Partial<AiSettings>): AiSettings {
  const provider = AI_PROVIDERS.some((item) => item.id === saved.provider) ? saved.provider as AiProviderId : "deepseek";
  const preset = getAiProvider(provider);
  return {
    ...DEFAULT_AI_SETTINGS,
    ...saved,
    provider,
    endpoint: provider === "custom" ? String(saved.endpoint ?? "") : preset.endpoint,
    apiKey: String(saved.apiKey ?? ""),
    model: String(saved.model ?? preset.defaultModel),
  };
}

export function buildAiPrompt(parent: ResumeNode, child: ResumeNode, report: DiffReport, job: Job, anonymize: boolean) {
  const changes = report.items.map((item) => ({
    diffItemId: item.id,
    type: item.kind,
    section: item.section,
    before: item.before,
    after: item.after,
    userNote: item.note,
  }));
  const prompt = `请对一份针对具体岗位修改的简历进行完整、审慎的匹配诊断。只依据提供的真实内容判断，不得补写、推断或虚构经历。不要把招聘方未明确说明的权重冒充事实。

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
  "overallMatch": {
    "scoreMin": 60,
    "scoreMax": 72,
    "evidenceSufficiency": "high | medium | low",
    "summary": "对当前简历与岗位匹配情况的客观概括",
    "reasons": ["形成该区间判断的主要理由"]
  },
  "requirements": [
    {
      "requirement": "从 JD 提炼的一项要求",
      "priority": "core | important | secondary",
      "status": "covered | partial | missing | unknown",
      "evidence": ["简历中的直接证据；没有则为空数组"],
      "reason": "为什么判为覆盖、部分覆盖、遗漏或无法判断"
    }
  ],
  "items": [
    {
      "diffItemId": "必须来自上述差异",
      "intent": "这项修改可能想突出什么",
      "jdRequirement": "它对应 JD 中的哪项要求；无明确对应时如实说明",
      "evaluation": "effective | partially_effective | neutral | weakens | unclear",
      "evidence": "判断这项修改是否有效的具体依据",
      "recommendation": "是否建议保留或继续调整，以及理由",
      "reusableFor": ["可复用的岗位类型"],
      "confidence": 0.8
    }
  ],
  "actions": [
    {
      "priority": "high | medium | low",
      "type": "revise | do_not_force",
      "action": "下一步行动；do_not_force 用于不应为了迎合 JD 而硬改的内容",
      "rationale": "行动理由，以及现有事实能否支撑"
    }
  ]
}

要求：
1. 匹配度必须输出区间而非单一分数，范围为 0 到 100，scoreMin 不得大于 scoreMax。
2. requirements 应覆盖 JD 的主要要求；没有简历证据时不得判为 covered。
3. 每个差异 ID 输出且只输出一次。confidence 必须是 0 到 1 之间的数字。
4. 行动建议必须区分“现有事实可以通过表达优化”与“缺少真实经历、不能靠关键词硬改”。
5. 不要输出 JSON 之外的文字。`;
  return anonymize ? anonymizeMaterial(prompt) : prompt;
}

type ParsedAnalysis = Pick<AiAnalysis, "overallMatch" | "requirements" | "items" | "actions">;

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T => allowed.includes(value as T) ? value as T : fallback;
const strings = (value: unknown) => Array.isArray(value) ? value.map(String).filter(Boolean) : [];

export function parseAiAnalysis(input: string, report: DiffReport): ParsedAnalysis {
  const normalized = input.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const start = normalized.indexOf("{");
  const end = normalized.lastIndexOf("}");
  const parsed = JSON.parse(start >= 0 && end > start ? normalized.slice(start, end + 1) : normalized) as Record<string, unknown>;
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error("AI 返回结果必须是 JSON 对象");
  const rawOverall = parsed.overallMatch as Record<string, unknown> | undefined;
  if (!rawOverall || typeof rawOverall !== "object") throw new Error("AI 返回结果缺少整体匹配结论");
  const scoreMin = Math.max(0, Math.min(100, Number(rawOverall.scoreMin)));
  const scoreMax = Math.max(0, Math.min(100, Number(rawOverall.scoreMax)));
  if (!Number.isFinite(scoreMin) || !Number.isFinite(scoreMax) || scoreMin > scoreMax) throw new Error("AI 返回的匹配区间无效");
  const overallMatch = {
    scoreMin,
    scoreMax,
    evidenceSufficiency: oneOf(rawOverall.evidenceSufficiency, ["high", "medium", "low"] as const, "low"),
    summary: String(rawOverall.summary ?? ""),
    reasons: strings(rawOverall.reasons),
  };
  if (!overallMatch.summary) throw new Error("AI 返回结果缺少匹配结论说明");

  if (!Array.isArray(parsed.requirements)) throw new Error("AI 返回结果缺少 JD 要求覆盖情况");
  const requirements: AiRequirementMatch[] = parsed.requirements.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      requirement: String(item?.requirement ?? ""),
      priority: oneOf(item?.priority, ["core", "important", "secondary"] as const, "important"),
      status: oneOf(item?.status, ["covered", "partial", "missing", "unknown"] as const, "unknown"),
      evidence: strings(item?.evidence),
      reason: String(item?.reason ?? ""),
    };
  }).filter((item) => item.requirement && item.reason);
  if (!requirements.length) throw new Error("AI 未返回有效的 JD 要求覆盖情况");

  const rawItems = parsed.items;
  if (!Array.isArray(rawItems)) throw new Error("AI 返回结果缺少 items 数组");
  const validIds = new Set(report.items.map((item) => item.id));
  const seen = new Set<string>();
  const items: AiAnalysisItem[] = rawItems.map((raw) => {
    const item = raw as Record<string, unknown>;
    const diffItemId = String(item?.diffItemId ?? "");
    if (!validIds.has(diffItemId) || seen.has(diffItemId)) throw new Error("AI 返回了无法对应或重复的差异项");
    seen.add(diffItemId);
    return {
      diffItemId,
      intent: String(item.intent ?? ""),
      jdRequirement: String(item.jdRequirement ?? ""),
      evaluation: oneOf(item.evaluation, ["effective", "partially_effective", "neutral", "weakens", "unclear"] as const, "unclear"),
      evidence: String(item.evidence ?? ""),
      recommendation: String(item.recommendation ?? ""),
      reusableFor: strings(item.reusableFor),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
    };
  });
  if (items.length !== report.items.length) throw new Error("AI 未覆盖全部差异项，请重试");

  if (!Array.isArray(parsed.actions)) throw new Error("AI 返回结果缺少行动建议");
  const actions: AiActionItem[] = parsed.actions.map((raw) => {
    const item = raw as Record<string, unknown>;
    return {
      priority: oneOf(item?.priority, ["high", "medium", "low"] as const, "medium"),
      type: oneOf(item?.type, ["revise", "do_not_force"] as const, "revise"),
      action: String(item?.action ?? ""),
      rationale: String(item?.rationale ?? ""),
    };
  }).filter((item) => item.action && item.rationale);
  if (!actions.length) throw new Error("AI 未返回有效的行动建议");
  return { overallMatch, requirements, items, actions };
}
