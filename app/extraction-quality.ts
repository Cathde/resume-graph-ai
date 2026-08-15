export type ExtractionQuality = {
  usable: boolean;
  reasons: string[];
};

const COMMON_ENGLISH_WORDS = new Set([
  "a", "an", "and", "as", "at", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
  "analysis", "business", "company", "content", "created", "data", "developed", "education", "experience",
  "intern", "internship", "managed", "management", "market", "marketing", "product", "project", "responsible",
  "skills", "student", "team", "university", "user", "users", "work",
]);

/** Detect text that is long enough to pass a simple length check, but is not safe for comparison. */
export function assessExtractedText(value: string): ExtractionQuality {
  const text = value.replace(/\r\n?/g, "\n").trim();
  const reasons: string[] = [];
  if (text.length < 80) reasons.push("未提取到足够文字");

  const replacementCount = (text.match(/[\uFFFD\u25A1\u25AF]/g) ?? []).length;
  const privateUseCount = (text.match(/[\uE000-\uF8FF]/g) ?? []).length;
  const brokenGlyphCount = replacementCount + privateUseCount;
  if (brokenGlyphCount >= 4 && brokenGlyphCount / Math.max(text.length, 1) >= 0.003) {
    reasons.push("提取结果包含大量无法映射的字形");
  }

  const latin = text.match(/[A-Za-z]/g) ?? [];
  const lower = text.match(/[a-z]/g) ?? [];
  const cjk = text.match(/[\u3400-\u9FFF]/g) ?? [];
  const words = (text.match(/[A-Za-z]{2,}/g) ?? []).map((word) => word.toLowerCase());
  const commonWordCount = words.filter((word) => COMMON_ENGLISH_WORDS.has(word)).length;
  const looksLikeEncodedGlyphs = latin.length >= 250
    && lower.length / latin.length < 0.04
    && cjk.length < 20
    && commonWordCount / Math.max(words.length, 1) < 0.025;
  if (looksLikeEncodedGlyphs) reasons.push("提取结果疑似为字体编码而非真实文字");

  return { usable: reasons.length === 0, reasons };
}
