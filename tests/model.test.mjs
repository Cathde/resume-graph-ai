import assert from "node:assert/strict";
import test from "node:test";
import {
  canAssignParent,
  canDeleteResume,
  compareResumeBlocks,
  emptyWorkspace,
  mergeDiffItems,
  resolveReviewItem,
  sortDiffItems,
  structureResumeText,
  validateWorkspace,
} from "../app/model.ts";

function resume(id, parentId, text) {
  return {
    id, parentId, name: id, fileId: `file-${id}`, filename: `${id}.docx`, fileType: "docx", fileSize: 10,
    fileHash: id, extractedText: text, blocks: structureResumeText(text), parseWarnings: [], createdAt: "2026-08-12T00:00:00Z", updatedAt: "2026-08-12T00:00:00Z",
  };
}

test("structure extraction recognizes headings and bullets", () => {
  const blocks = structureResumeText("个人概述\n内容增长方向\n实习经历\n• 负责内容策划\n• 数据提升 30%");
  assert.equal(blocks[0].kind, "heading");
  assert.equal(blocks[3].kind, "bullet");
  assert.equal(blocks[3].section, "实习经历");
});

test("block comparison separates formal changes from review candidates", () => {
  const parent = structureResumeText("实习经历\n• 负责内容策划与上线\n• 维护用户评论区\n技能\n数据分析");
  const child = structureResumeText("实习经历\n• 维护用户评论区\n• 独立负责内容策划与上线，互动率提升 30%\n• 新增 KOL 筛选流程\n技能\n英语");
  const report = compareResumeBlocks(parent, child, "要求内容增长、KOL、数据分析");
  const kinds = new Set(report.items.map((item) => item.kind));
  assert.ok(kinds.has("modified") || report.reviewItems.length > 0);
  assert.ok(kinds.has("added"));
  assert.ok(kinds.has("removed"));
  assert.ok(report.items.some((item) => item.keywordMatches.length > 0));
});

test("delete guard protects children and job links", () => {
  const root = resume("root", null, "教育背景\n学校");
  const child = resume("child", "root", "教育背景\n学校");
  const workspace = { ...emptyWorkspace(), resumes: [root, child] };
  assert.equal(canDeleteResume(workspace, "root").ok, false);
  assert.equal(canDeleteResume({ ...workspace, resumes: [root], links: [{ id: "l", jobId: "j", resumeId: "root", purpose: "候选", isSubmitted: false, createdAt: "" }] }, "root").ok, false);
  assert.equal(canDeleteResume({ ...workspace, resumes: [root] }, "root").ok, true);
});

test("parent assignment prevents self references and descendant cycles", () => {
  const root = resume("root", null, "教育背景\n学校");
  const child = resume("child", "root", "教育背景\n学校");
  const leaf = resume("leaf", "child", "教育背景\n学校");
  const workspace = { ...emptyWorkspace(), resumes: [root, child, leaf] };
  assert.equal(canAssignParent(workspace, "root", "leaf"), false);
  assert.equal(canAssignParent(workspace, "child", "child"), false);
  assert.equal(canAssignParent(workspace, "leaf", "root"), true);
  assert.equal(canAssignParent(workspace, "leaf", null), true);
});

test("workspace validation rejects malformed backups", () => {
  assert.equal(validateWorkspace(emptyWorkspace()).schemaVersion, 3);
  assert.throws(() => validateWorkspace({ schemaVersion: 1, resumes: [] }));
});

test("reordering complete internship entries creates one section summary only", () => {
  const parent = structureResumeText(`实习经历
艺康集团（世界500强）｜市场营销实习生｜上海｜2024.11 - 2025.03
• 制作销售物料与展会传播内容
得物App｜内容运营实习生｜上海｜2024.09 - 2024.11
• 优化达人广告脚本与评论区表达
新华社上海分社｜视频记者｜上海｜2024.06 - 2024.08
• 完成新闻视频拍摄与剪辑`);
  const child = structureResumeText(`实习经历
得物App｜内容运营实习生｜上海｜2024.09 - 2024.11
• 优化达人广告脚本与评论区表达
艺康集团（世界500强）｜市场营销实习生｜上海｜2024.11 - 2025.03
• 制作销售物料与展会传播内容
新华社上海分社｜视频记者｜上海｜2024.06 - 2024.08
• 完成新闻视频拍摄与剪辑`);
  const report = compareResumeBlocks(parent, child);
  assert.deepEqual(report.items.map((item) => item.kind), ["reordered"]);
  assert.equal(report.items[0].section, "实习经历");
  assert.equal(report.items[0].confidence, 1);
  assert.equal(report.reviewItems.length, 0);
});

test("format-only punctuation and spacing changes are ignored", () => {
  const parent = structureResumeText("实习经历\n得物App｜内容运营实习生｜上海｜2024.09 – 2024.11\n• 优化广告表达");
  const child = structureResumeText("实习经历\n得物App | 内容运营实习生 | 上海 | 2024.09 - 2024.11\n- 优化广告表达");
  const report = compareResumeBlocks(parent, child);
  assert.equal(report.items.length, 0);
  assert.equal(report.reviewItems.length, 0);
});

test("core capabilities and skills-language aliases match as one renamed section", () => {
  const parent = structureResumeText(`实习经历
新华社上海分社｜视频记者实习生｜上海｜2023.11 - 2024.01
• 官方内容交付：完成新闻视频拍摄与后期制作
核心能力
KOL/KOC筛选与资源管理｜海外社媒运营｜商业内容交付与审核｜AI辅助内容生产（ChatGPT/Codex、即梦）
中文：母语｜英语：CET-6 606，具备全英授课、演讲经历`);
  const child = structureResumeText(`实习经历
新华社上海分社｜视频记者实习生｜上海｜2023.11 - 2024.01
• 官方内容交付：完成新闻视频拍摄与后期制作
能力与语言
KOL/KOC筛选与资源管理｜海外社媒运营｜商业内容交付与审核｜AI辅助内容生产
中文：母语｜英语：CET-6 606，具备全英授课、演讲经历`);
  const report = compareResumeBlocks(parent, child);
  assert.equal(report.algorithmVersion, 3);
  assert.ok(report.items.some((item) => item.kind === "modified" && item.level === "section" && item.before === "核心能力" && item.after === "能力与语言"));
  assert.ok(report.items.some((item) => item.kind === "modified" && item.section === "能力与语言" && item.before.includes("ChatGPT/Codex")));
  assert.equal(report.items.filter((item) => item.kind === "added").length, 0);
  assert.equal(report.items.filter((item) => item.kind === "removed").length, 0);
  assert.equal(report.items.some((item) => item.section === "实习经历" && item.kind === "modified"), false);
});

test("body text containing capability is not treated as a section heading", () => {
  const blocks = structureResumeText("实习经历\n甲公司｜内容运营｜2025\n核心能力包括项目推进与沟通\n能力与语言\n英语：CET-6");
  assert.equal(blocks[2].kind, "text");
  assert.equal(blocks[2].section, "实习经历");
  assert.equal(blocks[3].kind, "heading");
});

test("a moved and rewritten entry appears in reorder and modified groups", () => {
  const parent = structureResumeText("实习经历\n甲公司｜内容实习生｜2024\n• 负责内容策划\n乙公司｜市场实习生｜2025\n• 制作营销物料");
  const child = structureResumeText("实习经历\n乙公司｜市场实习生｜2025\n• 独立制作营销物料并提升使用率\n甲公司｜内容实习生｜2024\n• 负责内容策划");
  const report = compareResumeBlocks(parent, child);
  assert.ok(report.items.some((item) => item.kind === "reordered"));
  assert.ok(report.items.some((item) => item.kind === "modified") || report.reviewItems.length > 0);
});

test("review candidates can become modified or split changes", () => {
  const parent = structureResumeText("实习经历\n内容运营");
  const child = structureResumeText("实习经历\n增长运营");
  const report = compareResumeBlocks(parent, child);
  assert.equal(report.reviewItems.length, 1);
  const modified = resolveReviewItem(report, report.reviewItems[0].id, "modified");
  assert.equal(modified.items[0].kind, "modified");
  assert.equal(modified.reviewItems.length, 0);
  const split = resolveReviewItem(report, report.reviewItems[0].id, "split");
  assert.deepEqual(split.items.map((item) => item.kind), ["removed", "added"]);
});

test("removed and added items can be manually merged and realign the documents", () => {
  const parent = structureResumeText("实习经历\n旧公司｜内容运营｜2024\n• 负责内容策划");
  const child = structureResumeText("项目经历\n新项目｜增长运营｜2025\n• 负责用户增长");
  const report = compareResumeBlocks(parent, child);
  const removed = report.items.find((item) => item.kind === "removed");
  const added = report.items.find((item) => item.kind === "added");
  assert.ok(removed && added);
  const merged = mergeDiffItems(report, removed.id, added.id);
  const change = merged.items.find((item) => item.kind === "modified");
  assert.equal(change?.source, "user");
  assert.equal(merged.items.some((item) => item.kind === "removed" || item.kind === "added"), false);
  assert.ok(merged.alignmentRows.some((row) => row.beforeUnit && row.afterUnit && row.diffItemIds.includes(change.id)));
});

test("formal differences follow the fixed group and document order", () => {
  const items = [
    { id: "a", kind: "added", section: "实习", before: "", after: "later", confidence: 1, note: "", keywordMatches: [], orderBefore: 99, orderAfter: 8 },
    { id: "r", kind: "removed", section: "实习", before: "old", after: "", confidence: 1, note: "", keywordMatches: [], orderBefore: 2, orderAfter: 99 },
    { id: "m", kind: "modified", section: "实习", before: "a", after: "b", confidence: .8, note: "", keywordMatches: [], orderBefore: 4, orderAfter: 5 },
    { id: "o", kind: "reordered", section: "实习", before: "a", after: "a", confidence: 1, note: "", keywordMatches: [], orderBefore: 1, orderAfter: 1 },
    { id: "a2", kind: "added", section: "实习", before: "", after: "earlier", confidence: 1, note: "", keywordMatches: [], orderBefore: 99, orderAfter: 6 },
  ];
  assert.deepEqual(sortDiffItems(items).map((item) => item.id), ["o", "m", "r", "a2", "a"]);
});

test("v1 workspaces migrate uncertain items into the review area", () => {
  const legacy = { ...emptyWorkspace(), schemaVersion: 1, diffs: [{ id: "d", parentResumeId: "p", childResumeId: "c", createdAt: "", items: [{ id: "u", kind: "uncertain", section: "实习经历", before: "甲", after: "乙", confidence: .43, needsReview: true, note: "核对", keywordMatches: [] }] }] };
  const migrated = validateWorkspace(legacy);
  assert.equal(migrated.schemaVersion, 3);
  assert.equal(migrated.diffs[0].items.length, 0);
  assert.equal(migrated.diffs[0].reviewItems[0].note, "核对");
  assert.equal(migrated.diffs[0].algorithmVersion, 1);
});
