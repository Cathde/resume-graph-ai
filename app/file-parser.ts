import { normalizeText, structureResumeText } from "./model";
import type { ResumeFileType } from "./model";
import { assessExtractedText } from "./extraction-quality";

export const MAX_FILE_SIZE = 10 * 1024 * 1024;

export function fileTypeOf(file: File): ResumeFileType {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  throw new Error("仅支持 .docx 和文本型 .pdf 文件");
}

export async function fileHash(file: File) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function parseResumeFile(file: File) {
  if (file.size > MAX_FILE_SIZE) throw new Error("文件不能超过 10MB");
  const fileType = fileTypeOf(file);
  const warnings: string[] = [];
  let text = "";
  if (fileType === "docx") {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
    text = result.value;
    warnings.push(...result.messages.map((item) => item.message));
  } else {
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.mjs";
    let pdf;
    try {
      pdf = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    } catch (error) {
      if (error instanceof pdfjs.PasswordException) throw new Error("PDF 已加密或设有打开密码，暂时无法识别");
      if (error instanceof pdfjs.InvalidPDFException) throw new Error("PDF 文件结构无效或已损坏，暂时无法识别");
      if (error instanceof pdfjs.ResponseException) throw new Error("PDF 文件读取失败，请重新选择文件后再试");
      const detail = error instanceof Error ? error.message : "未知错误";
      throw new Error(`PDF 解析组件加载失败，请刷新页面后重试（${detail}）`);
    }
    const pages: string[] = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      pages.push(content.items.map((item) => "str" in item ? item.str : "").join(" "));
    }
    text = pages.join("\n");
    warnings.push("PDF 的阅读顺序可能受双栏、文本框和特殊排版影响，请检查识别结果。");
  }
  text = normalizeText(text);
  const quality = assessExtractedText(text);
  return { fileType, text, blocks: structureResumeText(text), warnings, quality };
}
