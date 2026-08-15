export type JobStatus = "待判断" | "准备中" | "已投递" | "笔面试" | "已结束";
export type ResumeFileType = "docx" | "pdf";
export type DiffKind = "reordered" | "modified" | "removed" | "added";

export type ParsedBlock = {
  id: string;
  section: string;
  sectionKey: string;
  sectionOrder: number;
  kind: "heading" | "entry" | "bullet" | "text";
  level: "section" | "entry" | "content";
  text: string;
  order: number;
};

export type StructuredUnit = {
  id: string;
  sectionKey: string;
  sectionTitle: string;
  sectionOrder: number;
  kind: "entry" | "standalone";
  text: string;
  order: number;
};

export type StructuredSection = {
  key: string;
  title: string;
  order: number;
  units: StructuredUnit[];
};

export type AlignmentRow = {
  id: string;
  sectionKey: string;
  beforeSectionTitle: string;
  afterSectionTitle: string;
  beforeUnit: StructuredUnit | null;
  afterUnit: StructuredUnit | null;
  diffItemIds: string[];
};

export type ResumeNode = {
  id: string;
  name: string;
  parentId: string | null;
  fileId: string;
  filename: string;
  fileType: ResumeFileType;
  fileSize: number;
  fileHash: string;
  extractedText: string;
  blocks: ParsedBlock[];
  parseWarnings: string[];
  createdAt: string;
  updatedAt: string;
};

export type Job = {
  id: string;
  company: string;
  role: string;
  sourceUrl: string;
  jdText: string;
  deadline: string;
  nextAction: string;
  notes: string;
  status: JobStatus;
  createdAt: string;
  updatedAt: string;
};

export type JobResumeLink = {
  id: string;
  jobId: string;
  resumeId: string;
  purpose: string;
  isSubmitted: boolean;
  createdAt: string;
};

export type DiffItem = {
  id: string;
  kind: DiffKind;
  section: string;
  before: string;
  after: string;
  confidence: number;
  note: string;
  keywordMatches: string[];
  orderBefore: number;
  orderAfter: number;
  level: "section" | "entry" | "content";
  beforeAnchor: string | null;
  afterAnchor: string | null;
  source: "automatic" | "user";
};

export type ReviewItem = {
  id: string;
  section: string;
  before: string;
  after: string;
  confidence: number;
  reason: string;
  note: string;
  keywordMatches: string[];
  orderBefore: number;
  orderAfter: number;
};

export type SectionDocumentOrder = {
  section: string;
  entries: string[];
};

export type DiffReport = {
  id: string;
  parentResumeId: string;
  childResumeId: string;
  items: DiffItem[];
  reviewItems: ReviewItem[];
  algorithmVersion: 1 | 2 | 3;
  documentOrder: {
    before: SectionDocumentOrder[];
    after: SectionDocumentOrder[];
  };
  structuredDocument: {
    before: StructuredSection[];
    after: StructuredSection[];
  };
  alignmentRows: AlignmentRow[];
  createdAt: string;
};

export type AiAnalysisItem = {
  diffItemId: string;
  intent: string;
  jdRequirement: string;
  recommendation: string;
  reusableFor: string[];
  confidence: number;
  evaluation?: "effective" | "partially_effective" | "neutral" | "weakens" | "unclear";
  evidence?: string;
};

export type AiRequirementMatch = {
  requirement: string;
  priority: "core" | "important" | "secondary";
  status: "covered" | "partial" | "missing" | "unknown";
  evidence: string[];
  reason: string;
};

export type AiActionItem = {
  priority: "high" | "medium" | "low";
  type: "revise" | "do_not_force";
  action: string;
  rationale: string;
};

export type AiAnalysis = {
  id: string;
  resumeId: string;
  jobId: string;
  items: AiAnalysisItem[];
  importedAt: string;
  analysisVersion?: 2;
  overallMatch?: {
    scoreMin: number;
    scoreMax: number;
    evidenceSufficiency: "high" | "medium" | "low";
    summary: string;
    reasons: string[];
  };
  requirements?: AiRequirementMatch[];
  actions?: AiActionItem[];
};

export type Workspace = {
  schemaVersion: 3;
  resumes: ResumeNode[];
  jobs: Job[];
  links: JobResumeLink[];
  diffs: DiffReport[];
  aiAnalyses: AiAnalysis[];
  updatedAt: string;
};

export const JOB_STATUSES: JobStatus[] = ["待判断", "准备中", "已投递", "笔面试", "已结束"];

export function uid(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

export function emptyWorkspace(): Workspace {
  return { schemaVersion: 3, resumes: [], jobs: [], links: [], diffs: [], aiAnalyses: [], updatedAt: new Date().toISOString() };
}

export function normalizeText(value: string) {
  return value.replace(/\r/g, "").replace(/[\t ]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

const SECTION_ALIASES: Array<{ key: string; names: string[] }> = [
  { key: "summary", names: ["个人概述", "个人简介", "自我评价", "summary", "profile"] },
  { key: "education", names: ["教育背景", "教育经历", "education"] },
  { key: "experience", names: ["实习经历", "工作经历", "职业经历", "professional experience", "work experience"] },
  { key: "projects", names: ["项目经历", "projects", "project experience"] },
  { key: "campus", names: ["校园经历", "社团经历", "学生工作"] },
  { key: "skills", names: ["技能", "核心能力", "能力与语言", "技能与语言", "语言能力", "专业技能", "核心技能", "skills", "skills & languages"] },
  { key: "awards", names: ["荣誉奖项", "荣誉与奖项", "awards"] },
  { key: "certificates", names: ["证书", "资格证书", "certificates"] },
];

function cleanHeading(value: string) {
  return value.replace(/[：:]$/, "").replace(/\s+/g, " ").trim();
}

export function canonicalSectionKey(value: string) {
  const clean = cleanHeading(value).toLowerCase();
  return SECTION_ALIASES.find((group) => group.names.some((name) => clean === name.toLowerCase()))?.key ?? `custom:${clean}`;
}

function looksLikeHeading(line: string) {
  const clean = cleanHeading(line);
  return clean.length <= 24 && SECTION_ALIASES.some((group) => group.names.some((name) => clean.toLowerCase() === name.toLowerCase()));
}

function looksLikeBullet(line: string) {
  return /^[•·●▪◦*-]\s*/.test(line) || /^\d+[.)、]\s*/.test(line);
}

export function structureResumeText(input: string): ParsedBlock[] {
  const lines = normalizeText(input).split("\n").map((line) => line.trim()).filter(Boolean);
  let section = "基本信息";
  let sectionKey = "basics";
  let sectionOrder = 0;
  return lines.map((raw, order) => {
    const text = raw.replace(/^[•·●▪◦*-]\s*/, "").trim();
    let kind: ParsedBlock["kind"] = "text";
    if (looksLikeHeading(text)) {
      kind = "heading";
      section = cleanHeading(text);
      sectionKey = canonicalSectionKey(section);
      sectionOrder += 1;
    } else if (looksLikeBullet(raw)) {
      kind = "bullet";
    } else if (/\b(19|20)\d{2}\b/.test(text) || /(?:公司|大学|学院|研究院|工作室|中心)/.test(text)) {
      kind = "entry";
    }
    return { id: `block-${order}`, section, sectionKey, sectionOrder, kind, level: kind === "heading" ? "section" : kind === "entry" ? "entry" : "content", text, order };
  });
}

function tokens(value: string) {
  const lowered = value.toLowerCase();
  const result = new Set(lowered.replace(/[^a-z0-9+.#-]+/g, " ").split(/\s+/).filter((item) => item.length > 1));
  const chineseGroups = lowered.match(/[\u4e00-\u9fff]+/g) ?? [];
  for (const group of chineseGroups) {
    if (group.length <= 2) result.add(group);
    for (let index = 0; index < group.length - 1; index += 1) result.add(group.slice(index, index + 2));
  }
  return result;
}

export function similarity(a: string, b: string) {
  if (a === b) return 1;
  const left = tokens(a);
  const right = tokens(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  const jaccard = overlap / (left.size + right.size - overlap);
  const lengthRatio = Math.min(a.length, b.length) / Math.max(a.length, b.length);
  return Math.min(1, jaccard * 0.75 + lengthRatio * 0.25);
}

function jdKeywords(jdText: string) {
  const stop = new Set(["负责", "协助", "相关", "工作", "能力", "要求", "以及", "进行", "具备", "优先", "岗位", "我们", "通过"]);
  const words = normalizeText(jdText).match(/[A-Za-z][A-Za-z0-9+.#-]{1,}|[\u4e00-\u9fff]{2,6}/g) ?? [];
  const count = new Map<string, number>();
  for (const word of words) {
    const key = word.toLowerCase();
    if (!stop.has(key)) count.set(key, (count.get(key) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([word]) => word);
}

function findKeywordMatches(text: string, jdText: string) {
  const lowered = text.toLowerCase();
  return jdKeywords(jdText).filter((word) => lowered.includes(word)).slice(0, 6);
}

type ResumeUnit = {
  id: string;
  section: string;
  sectionKey: string;
  sectionOrder: number;
  kind: "entry" | "standalone";
  title: string;
  lines: string[];
  text: string;
  order: number;
  orderInSection: number;
};

type UnitMatch = {
  parent: ResumeUnit;
  child: ResumeUnit;
  confidence: number;
  exact: boolean;
  internalReorder: boolean;
};

const DIFF_ORDER: Record<DiffKind, number> = { reordered: 0, modified: 1, removed: 2, added: 3 };

function comparableLine(value: string) {
  return value.toLowerCase()
    .replace(/[‐‑‒–—−]/g, "-")
    .replace(/[|｜]/g, "|")
    .replace(/^[-•·●▪◦*]+\s*/, "")
    .replace(/\s*([|,，:：;；/])\s*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function unitsFromBlocks(blocks: ParsedBlock[]): ResumeUnit[] {
  const sections = new Map<string, ParsedBlock[]>();
  for (const block of blocks.filter((item) => item.kind !== "heading")) {
    const collection = sections.get(block.sectionKey) ?? [];
    collection.push(block);
    sections.set(block.sectionKey, collection);
  }
  const units: ResumeUnit[] = [];
  for (const [sectionKey, sectionBlocks] of sections) {
    const section = sectionBlocks[0]?.section ?? "未识别栏目";
    const sectionOrder = sectionBlocks[0]?.sectionOrder ?? 0;
    const hasEntries = sectionBlocks.some((item) => item.kind === "entry");
    let current: ParsedBlock[] = [];
    const append = (lines: ParsedBlock[], kind: ResumeUnit["kind"]) => {
      if (!lines.length) return;
      const texts = lines.map((item) => item.text);
      units.push({
        id: `unit-${lines[0].id}`,
        section, sectionKey, sectionOrder,
        kind,
        title: texts[0],
        lines: texts,
        text: texts.join("\n"),
        order: lines[0].order,
        orderInSection: units.filter((item) => item.section === section).length,
      });
    };
    if (!hasEntries) {
      for (const block of sectionBlocks) append([block], "standalone");
      continue;
    }
    for (const block of sectionBlocks) {
      if (block.kind === "entry") {
        append(current, current[0]?.kind === "entry" ? "entry" : "standalone");
        current = [block];
      } else if (current.length && current[0].kind === "entry") {
        current.push(block);
      } else {
        append([block], "standalone");
      }
    }
    append(current, current[0]?.kind === "entry" ? "entry" : "standalone");
  }
  return units.sort((a, b) => a.order - b.order);
}

function orderedSignature(unit: ResumeUnit) {
  return `${unit.sectionKey}::${unit.lines.map(comparableLine).join("\n")}`;
}

function contentSignature(unit: ResumeUnit) {
  const [title, ...body] = unit.lines.map(comparableLine);
  return `${unit.sectionKey}::${title}::${body.sort().join("\n")}`;
}

function unitSimilarity(previous: ResumeUnit, next: ResumeUnit) {
  if (previous.sectionKey !== next.sectionKey) return 0;
  if (previous.kind === "standalone" || next.kind === "standalone") return similarity(comparableLine(previous.text), comparableLine(next.text));
  const titleScore = similarity(comparableLine(previous.title), comparableLine(next.title));
  const bodyScore = similarity(previous.lines.slice(1).map(comparableLine).join(" "), next.lines.slice(1).map(comparableLine).join(" "));
  const fullScore = similarity(comparableLine(previous.text), comparableLine(next.text));
  const score = titleScore * 0.58 + bodyScore * 0.24 + fullScore * 0.18;
  return titleScore < 0.2 && fullScore < 0.42 ? score * 0.65 : score;
}

function maximumWeightPairs(scores: number[][]) {
  const rows = scores.length;
  const columns = scores[0]?.length ?? 0;
  if (!rows || !columns) return [] as Array<[number, number]>;
  const size = Math.max(rows, columns);
  const cost = Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, column) => 1 - (scores[row]?.[column] ?? 0)));
  const u = Array(size + 1).fill(0);
  const v = Array(size + 1).fill(0);
  const p = Array(size + 1).fill(0);
  const way = Array(size + 1).fill(0);
  for (let row = 1; row <= size; row += 1) {
    p[0] = row;
    let column0 = 0;
    const minValue = Array(size + 1).fill(Number.POSITIVE_INFINITY);
    const used = Array(size + 1).fill(false);
    do {
      used[column0] = true;
      const row0 = p[column0];
      let delta = Number.POSITIVE_INFINITY;
      let column1 = 0;
      for (let column = 1; column <= size; column += 1) {
        if (used[column]) continue;
        const current = cost[row0 - 1][column - 1] - u[row0] - v[column];
        if (current < minValue[column]) { minValue[column] = current; way[column] = column0; }
        if (minValue[column] < delta) { delta = minValue[column]; column1 = column; }
      }
      for (let column = 0; column <= size; column += 1) {
        if (used[column]) { u[p[column]] += delta; v[column] -= delta; }
        else minValue[column] -= delta;
      }
      column0 = column1;
    } while (p[column0] !== 0);
    do {
      const column1 = way[column0];
      p[column0] = p[column1];
      column0 = column1;
    } while (column0 !== 0);
  }
  const pairs: Array<[number, number]> = [];
  for (let column = 1; column <= size; column += 1) {
    const row = p[column] - 1;
    if (row >= 0 && row < rows && column - 1 < columns) pairs.push([row, column - 1]);
  }
  return pairs;
}

function makeDiff(kind: DiffKind, section: string, before: string, after: string, confidence: number, jdText: string, orderBefore: number, orderAfter: number, options: Partial<Pick<DiffItem, "level" | "beforeAnchor" | "afterAnchor" | "source">> = {}): DiffItem {
  return {
    id: uid("change"), kind, section, before, after,
    confidence: Math.round(confidence * 100) / 100,
    note: "",
    keywordMatches: findKeywordMatches(`${before} ${after}`, jdText),
    orderBefore,
    orderAfter,
    level: options.level ?? "content",
    beforeAnchor: options.beforeAnchor ?? null,
    afterAnchor: options.afterAnchor ?? null,
    source: options.source ?? "automatic",
  };
}

function makeReview(previous: ResumeUnit, next: ResumeUnit, confidence: number, jdText: string): ReviewItem {
  return {
    id: uid("review"), section: next.section, before: previous.text, after: next.text,
    confidence: Math.round(confidence * 100) / 100,
    reason: "两段内容存在一定相似性，但系统无法确定它们是否属于同一项经历。",
    note: "", keywordMatches: findKeywordMatches(`${previous.text} ${next.text}`, jdText),
    orderBefore: previous.order, orderAfter: next.order,
  };
}

export function sortDiffItems(items: DiffItem[]) {
  return [...items].sort((a, b) => {
    const kind = DIFF_ORDER[a.kind] - DIFF_ORDER[b.kind];
    if (kind) return kind;
    const first = a.kind === "removed" ? a.orderBefore : a.orderAfter;
    const second = b.kind === "removed" ? b.orderBefore : b.orderAfter;
    return first - second;
  });
}

function documentOrder(units: ResumeUnit[]): SectionDocumentOrder[] {
  const result: SectionDocumentOrder[] = [];
  for (const unit of units) {
    let section = result.find((item) => item.section === unit.section);
    if (!section) { section = { section: unit.section, entries: [] }; result.push(section); }
    section.entries.push(unit.text);
  }
  return result;
}

function structuredDocument(blocks: ParsedBlock[], units: ResumeUnit[]): StructuredSection[] {
  const headings = new Map<string, ParsedBlock>();
  for (const block of blocks.filter((item) => item.kind === "heading")) headings.set(block.sectionKey, block);
  const result: StructuredSection[] = [];
  for (const unit of units) {
    let section = result.find((item) => item.key === unit.sectionKey);
    if (!section) {
      const heading = headings.get(unit.sectionKey);
      section = { key: unit.sectionKey, title: heading?.section ?? unit.section, order: heading?.order ?? unit.order, units: [] };
      result.push(section);
    }
    section.units.push({ id: unit.id, sectionKey: unit.sectionKey, sectionTitle: unit.section, sectionOrder: unit.sectionOrder, kind: unit.kind, text: unit.text, order: unit.order });
  }
  return result.sort((a, b) => a.order - b.order);
}

export function buildStructuredDocument(blocks: ParsedBlock[]) {
  return structuredDocument(blocks, unitsFromBlocks(blocks));
}

function alignmentRows(parentUnits: ResumeUnit[], childUnits: ResumeUnit[], matches: UnitMatch[], items: DiffItem[]): AlignmentRow[] {
  const matchedParent = new Set(matches.map((match) => match.parent.id));
  const rows: AlignmentRow[] = [];
  const add = (before: ResumeUnit | null, after: ResumeUnit | null) => {
    const relevant = items.filter((item) => item.level !== "section" && (item.beforeAnchor === before?.id || item.afterAnchor === after?.id));
    rows.push({
      id: `row-${before?.id ?? "empty"}-${after?.id ?? "empty"}`,
      sectionKey: after?.sectionKey ?? before?.sectionKey ?? "unknown",
      beforeSectionTitle: before?.section ?? after?.section ?? "未识别栏目",
      afterSectionTitle: after?.section ?? before?.section ?? "未识别栏目",
      beforeUnit: before ? { id: before.id, sectionKey: before.sectionKey, sectionTitle: before.section, sectionOrder: before.sectionOrder, kind: before.kind, text: before.text, order: before.order } : null,
      afterUnit: after ? { id: after.id, sectionKey: after.sectionKey, sectionTitle: after.section, sectionOrder: after.sectionOrder, kind: after.kind, text: after.text, order: after.order } : null,
      diffItemIds: relevant.map((item) => item.id),
    });
  };
  const byChild = new Map(matches.map((match) => [match.child.id, match.parent]));
  for (const child of childUnits) add(byChild.get(child.id) ?? null, child);
  for (const parent of parentUnits.filter((item) => !matchedParent.has(item.id))) add(parent, null);
  return rows.sort((a, b) => (a.afterUnit?.order ?? a.beforeUnit?.order ?? 0) - (b.afterUnit?.order ?? b.beforeUnit?.order ?? 0));
}

export function compareResumeBlocks(parent: ParsedBlock[], child: ParsedBlock[], jdText = "", now = new Date().toISOString()): DiffReport {
  const parentUnits = unitsFromBlocks(parent);
  const childUnits = unitsFromBlocks(child);
  const usedParent = new Set<string>();
  const usedChild = new Set<string>();
  const matches: UnitMatch[] = [];

  const matchBySignature = (signature: (unit: ResumeUnit) => string, internalReorder: boolean) => {
    const queues = new Map<string, ResumeUnit[]>();
    for (const previous of parentUnits.filter((item) => !usedParent.has(item.id))) {
      const key = signature(previous);
      queues.set(key, [...(queues.get(key) ?? []), previous]);
    }
    for (const next of childUnits.filter((item) => !usedChild.has(item.id))) {
      const previous = queues.get(signature(next))?.shift();
      if (!previous) continue;
      usedParent.add(previous.id); usedChild.add(next.id);
      matches.push({ parent: previous, child: next, confidence: 1, exact: true, internalReorder });
    }
  };
  matchBySignature(orderedSignature, false);
  matchBySignature(contentSignature, true);

  const remainingParent = parentUnits.filter((item) => !usedParent.has(item.id));
  const remainingChild = childUnits.filter((item) => !usedChild.has(item.id));
  const scores = remainingParent.map((previous) => remainingChild.map((next) => unitSimilarity(previous, next)));
  const reviewItems: ReviewItem[] = [];
  for (const [parentIndex, childIndex] of maximumWeightPairs(scores)) {
    const confidence = scores[parentIndex][childIndex];
    if (confidence < 0.38) continue;
    const previous = remainingParent[parentIndex];
    const next = remainingChild[childIndex];
    usedParent.add(previous.id); usedChild.add(next.id);
    if (confidence >= 0.6) matches.push({ parent: previous, child: next, confidence, exact: false, internalReorder: false });
    else reviewItems.push(makeReview(previous, next, confidence, jdText));
  }

  const items: DiffItem[] = [];
  for (const sectionKey of [...new Set([...parentUnits, ...childUnits].map((item) => item.sectionKey))]) {
    const sectionMatches = matches.filter((item) => item.parent.sectionKey === sectionKey && item.child.sectionKey === sectionKey);
    const parentSequence = [...sectionMatches].sort((a, b) => a.parent.order - b.parent.order).map((item) => item.parent.id);
    const childSequence = [...sectionMatches].sort((a, b) => a.child.order - b.child.order).map((item) => item.parent.id);
    const relativeOrderChanged = parentSequence.length > 1 && parentSequence.some((id, index) => childSequence[index] !== id);
    if (relativeOrderChanged || sectionMatches.some((item) => item.internalReorder)) {
      const beforeUnits = parentUnits.filter((item) => item.sectionKey === sectionKey);
      const afterUnits = childUnits.filter((item) => item.sectionKey === sectionKey);
      items.push(makeDiff("reordered", afterUnits[0]?.section ?? beforeUnits[0]?.section ?? "未识别栏目", beforeUnits.map((item) => item.text).join("\n\n"), afterUnits.map((item) => item.text).join("\n\n"), 1, jdText, beforeUnits[0]?.order ?? 0, afterUnits[0]?.order ?? 0, { level: "section" }));
    }
  }
  const parentHeadings = new Map(parent.filter((item) => item.kind === "heading").map((item) => [item.sectionKey, item]));
  const childHeadings = new Map(child.filter((item) => item.kind === "heading").map((item) => [item.sectionKey, item]));
  for (const [sectionKey, nextHeading] of childHeadings) {
    const previousHeading = parentHeadings.get(sectionKey);
    if (previousHeading && comparableLine(previousHeading.section) !== comparableLine(nextHeading.section)) {
      items.push(makeDiff("modified", nextHeading.section, previousHeading.section, nextHeading.section, 1, jdText, previousHeading.order, nextHeading.order, { level: "section" }));
    }
  }
  for (const match of matches.filter((item) => !item.exact)) {
    items.push(makeDiff("modified", match.child.section, match.parent.text, match.child.text, match.confidence, jdText, match.parent.order, match.child.order, { level: match.child.kind === "entry" ? "entry" : "content", beforeAnchor: match.parent.id, afterAnchor: match.child.id }));
  }
  for (const previous of parentUnits.filter((item) => !usedParent.has(item.id))) {
    items.push(makeDiff("removed", previous.section, previous.text, "", 1, jdText, previous.order, Number.MAX_SAFE_INTEGER, { level: previous.kind === "entry" ? "entry" : "content", beforeAnchor: previous.id }));
  }
  for (const next of childUnits.filter((item) => !usedChild.has(item.id))) {
    items.push(makeDiff("added", next.section, "", next.text, 1, jdText, Number.MAX_SAFE_INTEGER, next.order, { level: next.kind === "entry" ? "entry" : "content", afterAnchor: next.id }));
  }

  const sortedItems = sortDiffItems(items);

  return {
    id: uid("diff"), parentResumeId: "", childResumeId: "", items: sortedItems,
    reviewItems: reviewItems.sort((a, b) => a.orderAfter - b.orderAfter), algorithmVersion: 3,
    documentOrder: { before: documentOrder(parentUnits), after: documentOrder(childUnits) }, createdAt: now,
    structuredDocument: { before: structuredDocument(parent, parentUnits), after: structuredDocument(child, childUnits) },
    alignmentRows: alignmentRows(parentUnits, childUnits, matches, sortedItems),
  };
}

export function resolveReviewItem(report: DiffReport, reviewId: string, resolution: "modified" | "split", jdText = ""): DiffReport {
  const review = report.reviewItems.find((item) => item.id === reviewId);
  if (!review) return report;
  const replacements = resolution === "modified"
    ? [makeDiff("modified", review.section, review.before, review.after, review.confidence, jdText, review.orderBefore, review.orderAfter)]
    : [
      makeDiff("removed", review.section, review.before, "", 1, jdText, review.orderBefore, Number.MAX_SAFE_INTEGER),
      makeDiff("added", review.section, "", review.after, 1, jdText, Number.MAX_SAFE_INTEGER, review.orderAfter),
    ];
  replacements[0].note = review.note;
  return { ...report, items: sortDiffItems([...report.items, ...replacements]), reviewItems: report.reviewItems.filter((item) => item.id !== reviewId) };
}

export function mergeDiffItems(report: DiffReport, firstId: string, secondId: string, jdText = ""): DiffReport {
  const first = report.items.find((item) => item.id === firstId);
  const second = report.items.find((item) => item.id === secondId);
  if (!first || !second || ![first.kind, second.kind].includes("added") || ![first.kind, second.kind].includes("removed")) return report;
  const removed = first.kind === "removed" ? first : second;
  const added = first.kind === "added" ? first : second;
  const merged = makeDiff("modified", added.section, removed.before, added.after, similarity(comparableLine(removed.before), comparableLine(added.after)), jdText, removed.orderBefore, added.orderAfter, { level: added.level, beforeAnchor: removed.beforeAnchor, afterAnchor: added.afterAnchor, source: "user" });
  merged.note = [removed.note && `删除项备注：${removed.note}`, added.note && `新增项备注：${added.note}`].filter(Boolean).join("\n");
  const items = sortDiffItems([...report.items.filter((item) => item.id !== removed.id && item.id !== added.id), merged]);
  const rows = report.alignmentRows.map((row) => ({ ...row, diffItemIds: row.diffItemIds.filter((id) => id !== removed.id && id !== added.id) }));
  const beforeRow = rows.find((row) => row.beforeUnit?.id === removed.beforeAnchor);
  const afterRow = rows.find((row) => row.afterUnit?.id === added.afterAnchor);
  if (beforeRow && afterRow && beforeRow !== afterRow) {
    afterRow.beforeUnit = beforeRow.beforeUnit;
    afterRow.beforeSectionTitle = beforeRow.beforeSectionTitle;
    afterRow.diffItemIds.push(merged.id);
    rows.splice(rows.indexOf(beforeRow), 1);
  } else if (afterRow) afterRow.diffItemIds.push(merged.id);
  return { ...report, items, alignmentRows: rows };
}

export function reconcileDiffReport(previous: DiffReport, next: DiffReport) {
  const remaining = [...previous.items];
  const matchedIds = new Set<string>();
  const items = next.items.map((item) => {
    const index = remaining.findIndex((old) => old.kind === item.kind && old.section === item.section && comparableLine(old.before) === comparableLine(item.before) && comparableLine(old.after) === comparableLine(item.after));
    if (index < 0) return item;
    const [old] = remaining.splice(index, 1);
    matchedIds.add(old.id);
    return { ...item, id: old.id, note: old.note };
  });
  const reviewItems = next.reviewItems.map((item) => {
    const old = previous.reviewItems.find((entry) => entry.section === item.section && comparableLine(entry.before) === comparableLine(item.before) && comparableLine(entry.after) === comparableLine(item.after));
    return old ? { ...item, id: old.id, note: old.note } : item;
  });
  return {
    report: { ...next, items, reviewItems },
    lostNoteCount: remaining.filter((item) => item.note.trim()).length + previous.reviewItems.filter((item) => item.note.trim() && !reviewItems.some((nextItem) => nextItem.id === item.id)).length,
    matchedIds,
  };
}

export function createJob(): Job {
  const now = new Date().toISOString();
  return { id: uid("job"), company: "", role: "", sourceUrl: "", jdText: "", deadline: "", nextAction: "", notes: "", status: "待判断", createdAt: now, updatedAt: now };
}

export function getDiffForResume(workspace: Workspace, resumeId: string) {
  return workspace.diffs.find((item) => item.childResumeId === resumeId) ?? null;
}

export function linkedJobs(workspace: Workspace, resumeId: string) {
  const jobIds = new Set(workspace.links.filter((link) => link.resumeId === resumeId).map((link) => link.jobId));
  return workspace.jobs.filter((job) => jobIds.has(job.id));
}

export function canDeleteResume(workspace: Workspace, resumeId: string) {
  const children = workspace.resumes.filter((item) => item.parentId === resumeId);
  const links = workspace.links.filter((item) => item.resumeId === resumeId);
  if (children.length) return { ok: false as const, reason: "请先将所有子版本改挂到其他父版本，或设为根简历。" };
  if (links.length) return { ok: false as const, reason: "请先解除这份简历与岗位的关联。" };
  return { ok: true as const, reason: "" };
}

export function canAssignParent(workspace: Workspace, resumeId: string, requestedParentId: string | null) {
  if (!requestedParentId) return true;
  if (resumeId === requestedParentId) return false;
  let current = workspace.resumes.find((item) => item.id === requestedParentId);
  const seen = new Set<string>();
  while (current) {
    if (current.id === resumeId || seen.has(current.id)) return false;
    seen.add(current.id);
    current = current.parentId ? workspace.resumes.find((item) => item.id === current?.parentId) : undefined;
  }
  return true;
}

export function anonymizeMaterial(value: string) {
  return value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[邮箱已隐藏]")
    .replace(/(?<!\d)1[3-9]\d{9}(?!\d)/g, "[手机号已隐藏]")
    .replace(/(?<!\d)\d{3,4}[- ]?\d{7,8}(?!\d)/g, "[电话已隐藏]");
}

export function validateWorkspace(value: unknown): Workspace {
  const data = value as Partial<Workspace> & { schemaVersion?: number; diffs?: Array<Record<string, unknown>> };
  if (!data || ![1, 2, 3].includes(data.schemaVersion ?? 0) || !Array.isArray(data.resumes) || !Array.isArray(data.jobs) || !Array.isArray(data.links) || !Array.isArray(data.diffs) || !Array.isArray(data.aiAnalyses)) {
    throw new Error("不是有效的 Resume Graph 备份");
  }
  const diffs = data.diffs.map((raw) => {
    const oldItems = Array.isArray(raw.items) ? raw.items as Array<Record<string, unknown>> : [];
    const reviewItems: ReviewItem[] = Array.isArray(raw.reviewItems) ? raw.reviewItems as ReviewItem[] : oldItems
      .filter((item) => item.kind === "uncertain")
      .map((item, index) => ({
        id: String(item.id ?? uid("review")), section: String(item.section ?? "未识别栏目"), before: String(item.before ?? ""), after: String(item.after ?? ""),
        confidence: Number(item.confidence ?? 0), reason: "这项结果由旧版规则标记为待确认。", note: String(item.note ?? ""),
        keywordMatches: Array.isArray(item.keywordMatches) ? item.keywordMatches.map(String) : [], orderBefore: index, orderAfter: index,
      }));
    const items = oldItems.filter((item) => item.kind !== "uncertain").map((item, index) => ({
      ...item,
      kind: item.kind as DiffKind,
      orderBefore: Number(item.orderBefore ?? index), orderAfter: Number(item.orderAfter ?? index),
      note: String(item.note ?? ""), keywordMatches: Array.isArray(item.keywordMatches) ? item.keywordMatches.map(String) : [],
      level: item.level === "section" || item.level === "entry" ? item.level : "content",
      beforeAnchor: typeof item.beforeAnchor === "string" ? item.beforeAnchor : null,
      afterAnchor: typeof item.afterAnchor === "string" ? item.afterAnchor : null,
      source: item.source === "user" ? "user" : "automatic",
    })) as DiffItem[];
    return {
      ...raw, items, reviewItems,
      algorithmVersion: raw.algorithmVersion === 3 ? 3 : raw.algorithmVersion === 2 ? 2 : 1,
      documentOrder: raw.documentOrder ?? { before: [], after: [] },
      structuredDocument: raw.structuredDocument ?? { before: [], after: [] },
      alignmentRows: raw.alignmentRows ?? [],
    } as DiffReport;
  });
  const resumes = data.resumes.map((resume) => ({ ...resume, blocks: structureResumeText(resume.extractedText) }));
  return { ...(data as unknown as Workspace), schemaVersion: 3, resumes, diffs };
}
