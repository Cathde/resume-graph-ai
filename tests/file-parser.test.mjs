import assert from "node:assert/strict";
import test from "node:test";
import { assessExtractedText } from "../app/extraction-quality.ts";

test("rejects PDF text with many unmapped glyphs", () => {
  const broken = `${"<JCPIEJGP <JQW UJVWFGPV KP CVJGQCVKEU CV 5JCPIJCK ".repeat(12)}������`;
  const result = assessExtractedText(broken);
  assert.equal(result.usable, false);
  assert.ok(result.reasons.some((reason) => reason.includes("字形") || reason.includes("字体编码")));
});

test("rejects long Caesar-like uppercase glyph codes without replacement characters", () => {
  const broken = "JCPIEJGP JQW UJVWFGPV KP CVJGQCVKEU CV JCPIJCK QP QRGTCVKQPU CPF OCTMGVKPI ".repeat(10);
  const result = assessExtractedText(broken);
  assert.equal(result.usable, false);
  assert.ok(result.reasons.some((reason) => reason.includes("字体编码")));
});

test("accepts normal Chinese and English resume text", () => {
  const chinese = "教育背景\n上海某大学 数字文创与管理\n实习经历\n某科技公司 产品运营实习生\n负责用户研究、内容策划与项目推进，支持产品功能上线并完成数据复盘。\n能力与语言\n英语 CET-6，熟练使用办公软件与 AI 工具。";
  const english = "EDUCATION\nShanghai University, Master of Management\nEXPERIENCE\nProduct Operations Intern\nManaged user research and content projects with the product and marketing team. Developed data analysis reports and improved the user experience.";
  assert.equal(assessExtractedText(chinese).usable, true);
  assert.equal(assessExtractedText(english).usable, true);
});

test("accepts corrected text after an unreliable extraction", () => {
  const corrected = "个人信息\n张同学 上海\n教育背景\n某大学 市场营销\n实习经历\n某公司 内容运营实习生\n负责达人筛选、内容审核和项目复盘，推动营销内容按计划上线。\n能力与语言\n英语 CET-6，具备数据分析和跨团队沟通能力。";
  assert.equal(assessExtractedText(corrected).usable, true);
});
