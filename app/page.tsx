"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fileHash, parseResumeFile } from "./file-parser";
import { assessExtractedText } from "./extraction-quality";
import { AI_SETTINGS_KEY, DEFAULT_AI_SETTINGS, buildDeepSeekPrompt, parseDeepSeekAnalysis } from "./ai";
import type { AiSettings } from "./ai";
import {
  JOB_STATUSES,
  buildStructuredDocument,
  canAssignParent,
  canDeleteResume,
  compareResumeBlocks,
  createJob,
  emptyWorkspace,
  getDiffForResume,
  linkedJobs,
  mergeDiffItems,
  reconcileDiffReport,
  resolveReviewItem,
  similarity,
  structureResumeText,
  uid,
} from "./model";
import type { AiAnalysisItem, AlignmentRow, DiffItem, DiffKind, DiffReport, Job, JobStatus, ResumeNode, ReviewItem, StructuredSection, Workspace } from "./model";
import { clearAllData, deleteFile, exportBackup, getFile, importBackup, loadWorkspace, saveFile, saveWorkspace } from "./storage";

type View = "jobs" | "resumes" | "graph";
type SaveState = "loading" | "saved" | "saving" | "error";
type UploadDraft = {
  file: File;
  fileType: "docx" | "pdf";
  fileHash: string;
  name: string;
  extractedText: string;
  warnings: string[];
  parentId: string;
  jobIds: string[];
};

const DIFF_LABELS: Record<DiffKind, string> = { reordered: "调序", modified: "改写", removed: "删除", added: "新增" };
const DIFF_GROUPS: Array<{ kind: DiffKind; description: string }> = [
  { kind: "reordered", description: "栏目内部的经历或成果顺序发生变化" },
  { kind: "modified", description: "系统较有把握地识别为同一内容的改写" },
  { kind: "removed", description: "只出现在父版本中的内容" },
  { kind: "added", description: "只出现在当前版本中的内容" },
];

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

export default function Home() {
  const [workspace, setWorkspace] = useState<Workspace>(() => emptyWorkspace());
  const [hydrated, setHydrated] = useState(false);
  const [view, setView] = useState<View>("jobs");
  const [saveState, setSaveState] = useState<SaveState>("loading");
  const [notice, setNotice] = useState("");
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const [jobEditor, setJobEditor] = useState<Job | null>(null);
  const [uploadDraft, setUploadDraft] = useState<UploadDraft | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedResumeId, setSelectedResumeId] = useState<string | null>(null);
  const [aiSettings, setAiSettings] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [aiDraft, setAiDraft] = useState<AiSettings>(DEFAULT_AI_SETTINGS);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [aiBusyKey, setAiBusyKey] = useState("");
  const [aiTesting, setAiTesting] = useState(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedJob = workspace.jobs.find((item) => item.id === selectedJobId) ?? null;
  const selectedResume = workspace.resumes.find((item) => item.id === selectedResumeId) ?? null;
  const selectedDiff = selectedResume ? getDiffForResume(workspace, selectedResume.id) : null;

  const notify = (message: string) => {
    setNotice(message);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(""), 3600);
  };

  useEffect(() => {
    loadWorkspace().then((loaded) => {
      setWorkspace(loaded);
      setSelectedJobId(loaded.jobs[0]?.id ?? null);
      setSelectedResumeId(loaded.resumes[0]?.id ?? null);
      setOnboardingOpen(loaded.jobs.length === 0 && loaded.resumes.length === 0);
      setHydrated(true);
      setSaveState("saved");
    }).catch(() => { setHydrated(true); setSaveState("error"); });
  }, []);

  useEffect(() => {
    const raw = localStorage.getItem(AI_SETTINGS_KEY) ?? sessionStorage.getItem(AI_SETTINGS_KEY);
    if (!raw) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      const saved = JSON.parse(raw) as Partial<AiSettings>;
      const next = { ...DEFAULT_AI_SETTINGS, ...saved, apiKey: String(saved.apiKey ?? ""), model: String(saved.model ?? DEFAULT_AI_SETTINGS.model) };
      timer = setTimeout(() => {
        setAiSettings(next);
        setAiDraft(next);
      }, 0);
    } catch {
      localStorage.removeItem(AI_SETTINGS_KEY);
      sessionStorage.removeItem(AI_SETTINGS_KEY);
    }
    return () => { if (timer) clearTimeout(timer); };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    const timer = setTimeout(() => {
      saveWorkspace(workspace).then(() => setSaveState("saved")).catch(() => setSaveState("error"));
    }, 300);
    return () => clearTimeout(timer);
  }, [workspace, hydrated]);

  const update = (updater: (current: Workspace) => Workspace) => {
    setSaveState("saving");
    setWorkspace((current) => ({ ...updater(current), updatedAt: new Date().toISOString() }));
  };

  const startJob = () => {
    setOnboardingOpen(false);
    setJobEditor(createJob());
  };

  const saveJob = () => {
    if (!jobEditor || !jobEditor.company.trim() || !jobEditor.role.trim()) {
      notify("请填写公司和岗位名称");
      return;
    }
    const exists = workspace.jobs.some((item) => item.id === jobEditor.id);
    update((current) => ({ ...current, jobs: exists ? current.jobs.map((item) => item.id === jobEditor.id ? { ...jobEditor, updatedAt: new Date().toISOString() } : item) : [...current.jobs, jobEditor] }));
    setSelectedJobId(jobEditor.id);
    setJobEditor(null);
    setView("jobs");
    notify(exists ? "岗位已更新" : "岗位已保存");
  };

  const selectUpload = () => {
    setOnboardingOpen(false);
    uploadInputRef.current?.click();
  };

  const prepareUpload = async (file: File) => {
    try {
      const hash = await fileHash(file);
      if (workspace.resumes.some((item) => item.fileHash === hash)) {
        notify("这份文件已经存在，未创建重复节点");
        return;
      }
      const parsed = await parseResumeFile(file);
      setUploadDraft({
        file, fileHash: hash, fileType: parsed.fileType,
        name: file.name.replace(/\.(docx|pdf)$/i, ""), extractedText: parsed.text,
        warnings: parsed.warnings, parentId: workspace.resumes.length ? "pending" : "",
        jobIds: selectedJobId ? [selectedJobId] : [],
      });
    } catch (error) {
      notify(error instanceof Error ? error.message : "文件识别失败");
    } finally {
      if (uploadInputRef.current) uploadInputRef.current.value = "";
    }
  };

  const saveUpload = async () => {
    if (!uploadDraft || !uploadDraft.name.trim()) return;
    const extractionQuality = assessExtractedText(uploadDraft.extractedText);
    if (!extractionQuality.usable) {
      notify("提取文本仍不可用，请粘贴正确文字或重新上传文件");
      return;
    }
    if (workspace.resumes.length > 0 && uploadDraft.parentId === "pending") {
      notify("请选择父版本，或明确设为新的根简历");
      return;
    }
    try {
      const now = new Date().toISOString();
      const id = uid("resume");
      const fileId = uid("file");
      const blocks = structureResumeText(uploadDraft.extractedText);
      const node: ResumeNode = {
        id, fileId, name: uploadDraft.name.trim(), parentId: uploadDraft.parentId || null,
        filename: uploadDraft.file.name, fileType: uploadDraft.fileType, fileSize: uploadDraft.file.size,
        fileHash: uploadDraft.fileHash, extractedText: uploadDraft.extractedText, blocks,
        parseWarnings: uploadDraft.warnings, createdAt: now, updatedAt: now,
      };
      await saveFile(fileId, uploadDraft.file);
      update((current) => {
        const parent = current.resumes.find((item) => item.id === node.parentId);
        const jdText = current.jobs.filter((job) => uploadDraft.jobIds.includes(job.id)).map((job) => job.jdText).join("\n");
        const report = parent ? { ...compareResumeBlocks(parent.blocks, blocks, jdText, now), parentResumeId: parent.id, childResumeId: id } : null;
        const links = uploadDraft.jobIds.map((jobId) => ({ id: uid("link"), jobId, resumeId: id, purpose: "候选版本", isSubmitted: false, createdAt: now }));
        return { ...current, resumes: [...current.resumes, node], links: [...current.links, ...links], diffs: report ? [...current.diffs, report] : current.diffs };
      });
      setSelectedResumeId(id);
      setUploadDraft(null);
      setView("resumes");
      notify(node.parentId ? "简历已保存，并生成版本差异" : "根简历已保存");
    } catch {
      notify("原文件保存失败，请检查浏览器存储空间");
    }
  };

  const downloadResume = async (resume: ResumeNode) => {
    const file = await getFile(resume.fileId);
    if (!file) return notify("找不到原文件，请从完整备份恢复");
    downloadBlob(file, resume.filename);
  };

  const setSubmitted = (jobId: string, resumeId: string) => {
    if (workspace.links.some((link) => link.jobId === jobId && link.isSubmitted)) {
      notify("这个岗位已经冻结了实际投递版本，不能改为其他版本");
      return;
    }
    update((current) => ({ ...current, links: current.links.map((link) => link.jobId === jobId && link.resumeId === resumeId ? { ...link, isSubmitted: true } : link) }));
    notify("已冻结实际投递版本");
  };

  const linkExistingResume = (jobId: string, resumeId: string) => {
    if (!resumeId) return;
    if (workspace.links.some((link) => link.jobId === jobId && link.resumeId === resumeId)) return notify("这份简历已经关联该岗位");
    update((current) => ({ ...current, links: [...current.links, { id: uid("link"), jobId, resumeId, purpose: "候选版本", isSubmitted: false, createdAt: new Date().toISOString() }] }));
    notify("已有简历已关联岗位");
  };

  const reparentResume = (resume: ResumeNode, parentId: string | null) => {
    if (!canAssignParent(workspace, resume.id, parentId)) return notify("不能把简历挂到自己的后代节点下");
    update((current) => {
      const parent = current.resumes.find((item) => item.id === parentId);
      const jdText = linkedJobs(current, resume.id).map((job) => job.jdText).join("\n");
      const nextReport = parent ? { ...compareResumeBlocks(parent.blocks, resume.blocks, jdText), parentResumeId: parent.id, childResumeId: resume.id } : null;
      return {
        ...current,
        resumes: current.resumes.map((item) => item.id === resume.id ? { ...item, parentId, updatedAt: new Date().toISOString() } : item),
        diffs: [...current.diffs.filter((item) => item.childResumeId !== resume.id), ...(nextReport ? [nextReport] : [])],
        aiAnalyses: current.aiAnalyses.filter((item) => item.resumeId !== resume.id),
      };
    });
    notify(parentId ? "父版本已更新，差异已重新计算" : "已设为新的根简历");
  };

  const reanalyzeResume = (resume: ResumeNode) => {
    const parent = workspace.resumes.find((item) => item.id === resume.parentId);
    const previous = getDiffForResume(workspace, resume.id);
    if (!parent || !previous) return notify("根简历没有可重新识别的父版本差异");
    const jdText = linkedJobs(workspace, resume.id).map((job) => job.jdText).join("\n");
    const parentBlocks = structureResumeText(parent.extractedText);
    const childBlocks = structureResumeText(resume.extractedText);
    const next = { ...compareResumeBlocks(parentBlocks, childBlocks, jdText), parentResumeId: parent.id, childResumeId: resume.id };
    const reconciled = reconcileDiffReport(previous, next);
    const lostAiCount = workspace.aiAnalyses
      .filter((analysis) => analysis.resumeId === resume.id)
      .flatMap((analysis) => analysis.items)
      .filter((item) => !reconciled.matchedIds.has(item.diffItemId)).length;
    const effects = [
      reconciled.lostNoteCount ? `${reconciled.lostNoteCount} 条旧备注无法迁移` : "旧备注均可迁移或没有旧备注",
      lostAiCount ? `${lostAiCount} 条 AI 分析将移除` : "现有 AI 分析均可保留或尚未生成",
    ].join("；");
    if (!window.confirm(`将使用新版规则重新识别这份简历。${effects}。确认覆盖旧差异报告吗？`)) return;
    update((current) => ({
      ...current,
      resumes: current.resumes.map((item) => item.id === parent.id ? { ...item, blocks: parentBlocks } : item.id === resume.id ? { ...item, blocks: childBlocks } : item),
      diffs: current.diffs.map((report) => report.childResumeId === resume.id ? reconciled.report : report),
      aiAnalyses: current.aiAnalyses.map((analysis) => analysis.resumeId !== resume.id ? analysis : ({
        ...analysis, items: analysis.items.filter((item) => reconciled.matchedIds.has(item.diffItemId)),
      })).filter((analysis) => analysis.resumeId !== resume.id || analysis.items.length > 0),
    }));
    notify("已使用新版规则重新识别");
  };

  const resolveReview = (reviewId: string, resolution: "modified" | "split") => {
    if (!selectedResume || !selectedDiff) return;
    const jdText = linkedJobs(workspace, selectedResume.id).map((job) => job.jdText).join("\n");
    update((current) => ({ ...current, diffs: current.diffs.map((report) => report.childResumeId === selectedResume.id ? resolveReviewItem(report, reviewId, resolution, jdText) : report) }));
    notify(resolution === "modified" ? "已确认为改写" : "已拆分为删除和新增");
  };

  const mergeChanges = (firstId: string, secondId: string) => {
    if (!selectedResume || !selectedDiff) return;
    const affected = workspace.aiAnalyses.filter((analysis) => analysis.resumeId === selectedResume.id).flatMap((analysis) => analysis.items).filter((item) => item.diffItemId === firstId || item.diffItemId === secondId).length;
    if (!window.confirm(`将这两项合并为一条“用户确认”的改写。${affected ? `${affected} 条相关 AI 分析将移除。` : "没有相关 AI 分析。"}确认继续吗？`)) return;
    const jdText = linkedJobs(workspace, selectedResume.id).map((job) => job.jdText).join("\n");
    update((current) => ({
      ...current,
      diffs: current.diffs.map((report) => report.childResumeId === selectedResume.id ? mergeDiffItems(report, firstId, secondId, jdText) : report),
      aiAnalyses: current.aiAnalyses.map((analysis) => analysis.resumeId !== selectedResume.id ? analysis : ({ ...analysis, items: analysis.items.filter((item) => item.diffItemId !== firstId && item.diffItemId !== secondId) })).filter((analysis) => analysis.resumeId !== selectedResume.id || analysis.items.length > 0),
    }));
    notify("已合并为用户确认的改写");
  };

  const updateReview = (review: ReviewItem) => {
    if (!selectedResume) return;
    update((current) => ({ ...current, diffs: current.diffs.map((report) => report.childResumeId === selectedResume.id ? { ...report, reviewItems: report.reviewItems.map((item) => item.id === review.id ? review : item) } : report) }));
  };

  const unlinkResume = (jobId: string, resumeId: string) => {
    const link = workspace.links.find((item) => item.jobId === jobId && item.resumeId === resumeId);
    if (link?.isSubmitted) return notify("实际投递版本不可直接解除，请先选择另一份实际投递版本");
    update((current) => ({ ...current, links: current.links.filter((item) => !(item.jobId === jobId && item.resumeId === resumeId)) }));
  };

  const deleteResume = async (resume: ResumeNode) => {
    const allowed = canDeleteResume(workspace, resume.id);
    if (!allowed.ok) return notify(allowed.reason);
    if (!window.confirm(`永久删除「${resume.name}」及其原文件和差异记录？此操作不可恢复。`)) return;
    if (!window.confirm("再次确认：删除后只能通过此前导出的完整 ZIP 备份恢复。")) return;
    await deleteFile(resume.fileId);
    update((current) => ({ ...current, resumes: current.resumes.filter((item) => item.id !== resume.id), diffs: current.diffs.filter((item) => item.childResumeId !== resume.id && item.parentResumeId !== resume.id), aiAnalyses: current.aiAnalyses.filter((item) => item.resumeId !== resume.id) }));
    setSelectedResumeId(null);
    notify("简历已永久删除");
  };

  const openAiSettings = () => {
    setAiDraft(aiSettings);
    setAiSettingsOpen(true);
  };

  const saveAiSettings = () => {
    const next = { ...aiDraft, apiKey: aiDraft.apiKey.trim(), model: aiDraft.model.trim() };
    if (!next.apiKey || !next.model) return notify("请填写 API Key 和模型名称");
    const storage = next.remember ? localStorage : sessionStorage;
    const other = next.remember ? sessionStorage : localStorage;
    storage.setItem(AI_SETTINGS_KEY, JSON.stringify(next));
    other.removeItem(AI_SETTINGS_KEY);
    setAiSettings(next);
    setAiSettingsOpen(false);
    notify(next.remember ? "AI 设置已保存到当前浏览器" : "AI 设置仅在本次浏览器会话中有效");
  };

  const clearAiSettings = () => {
    localStorage.removeItem(AI_SETTINGS_KEY);
    sessionStorage.removeItem(AI_SETTINGS_KEY);
    setAiSettings(DEFAULT_AI_SETTINGS);
    setAiDraft(DEFAULT_AI_SETTINGS);
    notify("API Key 已从当前浏览器清除");
  };

  const requestDeepSeek = async (settings: AiSettings, mode: "test" | "analyze", prompt = "") => {
    const response = await fetch("/api/ai", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: settings.apiKey, model: settings.model, mode, prompt }),
    });
    const data = await response.json() as { content?: string; error?: string; usage?: { total_tokens?: number } };
    if (!response.ok || !data.content) throw new Error(data.error || "DeepSeek 请求失败");
    return data;
  };

  const testAiConnection = async () => {
    if (!aiDraft.apiKey.trim() || !aiDraft.model.trim()) return notify("请先填写 API Key 和模型名称");
    setAiTesting(true);
    try {
      await requestDeepSeek(aiDraft, "test");
      notify("DeepSeek 连接成功");
    } catch (error) {
      notify(error instanceof Error ? error.message : "DeepSeek 连接失败");
    } finally { setAiTesting(false); }
  };

  const analyzeWithAi = async (resume: ResumeNode, job: Job) => {
    const report = getDiffForResume(workspace, resume.id);
    const parent = workspace.resumes.find((item) => item.id === resume.parentId);
    if (!report || !parent) return notify("根简历没有可分析的父版本差异");
    if (!report.items.length) return notify("没有已确认的差异可供 AI 分析");
    if (!aiSettings.apiKey) {
      openAiSettings();
      return notify("请先配置 DeepSeek API");
    }
    const busyKey = `${resume.id}:${job.id}`;
    setAiBusyKey(busyKey);
    try {
      const prompt = buildDeepSeekPrompt(parent, resume, report, job, aiSettings.anonymize);
      const result = await requestDeepSeek(aiSettings, "analyze", prompt);
      const items = parseDeepSeekAnalysis(result.content, report);
      update((current) => ({ ...current, aiAnalyses: [...current.aiAnalyses.filter((item) => !(item.resumeId === resume.id && item.jobId === job.id)), { id: uid("ai"), resumeId: resume.id, jobId: job.id, items, importedAt: new Date().toISOString() }] }));
      setSelectedResumeId(resume.id);
      setSelectedJobId(job.id);
      notify(`DeepSeek 分析已保存${result.usage?.total_tokens ? ` · ${result.usage.total_tokens} tokens` : ""}`);
    } catch (error) {
      notify(error instanceof Error ? error.message : "AI 分析失败");
    } finally { setAiBusyKey(""); }
  };

  const doBackup = async () => {
    if (!window.confirm("完整 ZIP 备份包含简历原文件和个人信息，且未加密。请妥善保管。继续导出吗？")) return;
    try { downloadBlob(await exportBackup(workspace), `resume-graph-backup-${new Date().toISOString().slice(0, 10)}.zip`); }
    catch (error) { notify(error instanceof Error ? error.message : "备份生成失败"); }
  };

  const restoreBackup = async (file: File) => {
    if (!window.confirm("导入将覆盖当前浏览器中的全部 Resume Graph 数据。继续吗？")) return;
    try {
      const restored = await importBackup(file);
      setWorkspace(restored);
      setSelectedJobId(restored.jobs[0]?.id ?? null);
      setSelectedResumeId(restored.resumes[0]?.id ?? null);
      notify("完整备份已恢复");
    } catch (error) { notify(error instanceof Error ? error.message : "备份恢复失败"); }
    finally { if (backupInputRef.current) backupInputRef.current.value = ""; }
  };

  const deleteAll = async () => {
    if (!window.confirm("永久清空当前浏览器中的全部岗位、简历和原文件？此操作不可恢复。")) return;
    if (!window.confirm("请再次确认。建议先导出完整 ZIP 备份。")) return;
    await clearAllData();
    setWorkspace(emptyWorkspace());
    setSelectedJobId(null); setSelectedResumeId(null); setView("jobs"); setOnboardingOpen(true);
  };

  const counts = useMemo(() => ({
    active: workspace.jobs.filter((job) => !["已结束"].includes(job.status)).length,
    submitted: workspace.jobs.filter((job) => ["已投递", "笔面试"].includes(job.status)).length,
    changes: workspace.diffs.reduce((sum, diff) => sum + diff.items.length, 0),
  }), [workspace]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setView("jobs")}><span className="brand-mark">RG</span><span><strong>Resume Graph AI</strong><small>个人 AI 分析版</small></span></button>
        <nav aria-label="主要导航">
          <button className={view === "jobs" ? "active" : ""} onClick={() => setView("jobs")}>岗位工作台</button>
          <button className={view === "resumes" ? "active" : ""} onClick={() => setView("resumes")}>简历库</button>
          <button className={view === "graph" ? "active" : ""} onClick={() => setView("graph")}>简历谱系</button>
        </nav>
        <div className="top-actions">
          <span className={`save-pill save-${saveState}`}>{saveState === "loading" ? "读取中" : saveState === "saving" ? "保存中…" : saveState === "error" ? "保存失败" : "已保存在本机"}</span>
          <button className="ghost ai-settings-button" onClick={openAiSettings}><span className={aiSettings.apiKey ? "ai-dot configured" : "ai-dot"} />AI 设置</button>
          <button className="ghost" onClick={doBackup}>导出完整备份</button>
          <button className="primary" onClick={selectUpload}>＋ 上传新简历</button>
        </div>
      </header>

      {notice && <div className="toast" role="status">{notice}</div>}
      <input ref={uploadInputRef} className="sr-only" type="file" accept=".docx,.pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/pdf" onChange={(event) => event.target.files?.[0] && prepareUpload(event.target.files[0])} />
      <input ref={backupInputRef} className="sr-only" type="file" accept=".zip,application/zip" onChange={(event) => event.target.files?.[0] && restoreBackup(event.target.files[0])} />

      <section className="privacy-strip"><span>本地资料库</span> 原始文件与识别结果只存当前浏览器；仅在你主动分析时向 DeepSeek 发送必要文本。</section>

      {view === "jobs" && <JobWorkspace workspace={workspace} counts={counts} selectedJob={selectedJob} onSelect={setSelectedJobId} onCreate={startJob} onEdit={setJobEditor} onUpdate={(job) => update((current) => ({ ...current, jobs: current.jobs.map((item) => item.id === job.id ? job : item) }))} onDelete={(job) => { if (window.confirm(`永久删除岗位「${job.company}｜${job.role}」及其关联记录？`)) { update((current) => ({ ...current, jobs: current.jobs.filter((item) => item.id !== job.id), links: current.links.filter((item) => item.jobId !== job.id), aiAnalyses: current.aiAnalyses.filter((item) => item.jobId !== job.id) })); setSelectedJobId(null); } }} onOpenResume={(id) => { setSelectedResumeId(id); setView("resumes"); }} onSubmitted={setSubmitted} onUnlink={unlinkResume} onLink={linkExistingResume} onAnalyze={analyzeWithAi} aiBusyKey={aiBusyKey} />}
      {view === "resumes" && <ResumeLibrary workspace={workspace} selectedResume={selectedResume} onSelect={setSelectedResumeId} onUpload={selectUpload} onDownload={downloadResume} onDelete={deleteResume} onReparent={reparentResume} onReanalyze={reanalyzeResume} onMergeChanges={mergeChanges} onUpdateDiff={(item) => update((current) => ({ ...current, diffs: current.diffs.map((report) => report.childResumeId === selectedResume?.id ? { ...report, items: report.items.map((entry) => entry.id === item.id ? item : entry) } : report) }))} onUpdateReview={updateReview} onResolveReview={resolveReview} onOpenJob={(id) => { setSelectedJobId(id); setView("jobs"); }} />}
      {view === "graph" && <GraphView workspace={workspace} selectedId={selectedResumeId} onSelect={setSelectedResumeId} onOpen={(id) => { setSelectedResumeId(id); setView("resumes"); }} onUpload={selectUpload} />}

      <footer className="footer"><span>Resume Graph AI · 本地优先的个人求职资料库</span><div><button onClick={() => backupInputRef.current?.click()}>导入完整备份</button><button className="danger-text" onClick={deleteAll}>清空全部数据</button></div></footer>

      {onboardingOpen && <Onboarding onUpload={selectUpload} onJob={startJob} onClose={() => setOnboardingOpen(false)} />}
      {jobEditor && <JobModal job={jobEditor} onChange={setJobEditor} onSave={saveJob} onClose={() => setJobEditor(null)} />}
      {uploadDraft && <UploadModal draft={uploadDraft} resumes={workspace.resumes} jobs={workspace.jobs} onChange={setUploadDraft} onSave={saveUpload} onClose={() => setUploadDraft(null)} />}
      {aiSettingsOpen && <AiSettingsModal settings={aiDraft} testing={aiTesting} onChange={setAiDraft} onTest={testAiConnection} onSave={saveAiSettings} onClear={clearAiSettings} onClose={() => setAiSettingsOpen(false)} />}
    </main>
  );
}

function JobWorkspace({ workspace, counts, selectedJob, onSelect, onCreate, onEdit, onUpdate, onDelete, onOpenResume, onSubmitted, onUnlink, onLink, onAnalyze, aiBusyKey }: {
  workspace: Workspace; counts: { active: number; submitted: number; changes: number }; selectedJob: Job | null; onSelect: (id: string) => void; onCreate: () => void; onEdit: (job: Job) => void; onUpdate: (job: Job) => void; onDelete: (job: Job) => void; onOpenResume: (id: string) => void; onSubmitted: (jobId: string, resumeId: string) => void; onUnlink: (jobId: string, resumeId: string) => void; onLink: (jobId: string, resumeId: string) => void; onAnalyze: (resume: ResumeNode, job: Job) => void; aiBusyKey: string;
}) {
  const links = selectedJob ? workspace.links.filter((item) => item.jobId === selectedJob.id) : [];
  return <div className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">JOB WORKSPACE</p><h1>每次投递，都知道用了哪一版</h1><p>围绕岗位管理 JD、定制简历和下一步行动。</p></div><button className="primary large" onClick={onCreate}>＋ 保存岗位 JD</button></div>
    <div className="metrics"><Metric value={counts.active} label="进行中的岗位" /><Metric value={counts.submitted} label="已投递 / 笔面试" /><Metric value={workspace.resumes.length} label="简历版本" /><Metric value={counts.changes} label="已识别改动" /></div>
    {workspace.jobs.length === 0 ? <EmptyPanel title="先从一个真实岗位开始" text="保存完整 JD，再关联现有简历或上传针对它修改的新版本。" action="保存第一个岗位" onAction={onCreate} /> : <div className="split-layout">
      <section className="list-panel"><div className="panel-title"><h2>全部岗位</h2><span>{workspace.jobs.length}</span></div>{workspace.jobs.map((job) => <button className={`job-row ${selectedJob?.id === job.id ? "selected" : ""}`} key={job.id} onClick={() => onSelect(job.id)}><span className={`status-dot status-${JOB_STATUSES.indexOf(job.status)}`} /><span><strong>{job.company || "未命名公司"}</strong><small>{job.role || "未命名岗位"}</small></span><em>{job.status}</em></button>)}</section>
      <section className="detail-panel">{selectedJob ? <>
        <div className="detail-header"><div><span className="status-chip">{selectedJob.status}</span><h2>{selectedJob.company}｜{selectedJob.role}</h2><p>{selectedJob.nextAction || "尚未设置下一步行动"}</p></div><div className="button-row"><button onClick={() => onEdit({ ...selectedJob })}>编辑岗位</button><button className="danger-text" onClick={() => onDelete(selectedJob)}>删除</button></div></div>
        <div className="job-facts"><label>阶段<select value={selectedJob.status} onChange={(event) => onUpdate({ ...selectedJob, status: event.target.value as JobStatus, updatedAt: new Date().toISOString() })}>{JOB_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label><span><small>截止时间</small>{selectedJob.deadline || "未设置"}</span><span><small>最近更新</small>{formatDate(selectedJob.updatedAt)}</span></div>
        <div className="detail-section"><div className="section-heading"><h3>关联简历</h3><span>同一版本可以用于多个相似岗位</span></div>{workspace.resumes.length > 0 && <label className="link-picker">关联已有简历<select defaultValue="" onChange={(event) => { onLink(selectedJob.id, event.target.value); event.currentTarget.value = ""; }}><option value="">请选择…</option>{workspace.resumes.filter((resume) => !links.some((link) => link.resumeId === resume.id)).map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}</select></label>}{links.length === 0 ? <p className="quiet-box">尚未关联简历。可以选择已有版本，或上传新简历时关联这个岗位。</p> : links.map((link) => { const resume = workspace.resumes.find((item) => item.id === link.resumeId); if (!resume) return null; const diff = getDiffForResume(workspace, resume.id); const busy = aiBusyKey === `${resume.id}:${selectedJob.id}`; return <div className="linked-resume" key={link.id}><button className="resume-link-main" onClick={() => onOpenResume(resume.id)}><strong>{resume.name}</strong><span>{resume.fileType.toUpperCase()} · {diff?.items.length ?? 0} 处改动</span></button><div>{link.isSubmitted ? <span className="submitted">实际投递版本</span> : <button onClick={() => onSubmitted(selectedJob.id, resume.id)}>标记为已投递</button>}<button className="ai-analyze-button" onClick={() => onAnalyze(resume, selectedJob)} disabled={!resume.parentId || busy}>{busy ? "分析中…" : "DeepSeek 分析"}</button><button className="danger-text" onClick={() => onUnlink(selectedJob.id, resume.id)}>解除关联</button></div></div>; })}</div>
        <div className="detail-section"><div className="section-heading"><h3>JD 快照</h3>{/^https?:\/\//.test(selectedJob.sourceUrl) && <a href={selectedJob.sourceUrl} target="_blank" rel="noreferrer">打开来源 ↗</a>}</div><pre className="jd-view">{selectedJob.jdText || "尚未填写 JD 正文。"}</pre></div>
        {selectedJob.notes && <div className="detail-section"><h3>备注</h3><p className="notes-view">{selectedJob.notes}</p></div>}
      </> : <div className="detail-placeholder">选择一个岗位查看详情</div>}</section>
    </div>}
  </div>;
}

function ResumeLibrary({ workspace, selectedResume, onSelect, onUpload, onDownload, onDelete, onReparent, onReanalyze, onMergeChanges, onUpdateDiff, onUpdateReview, onResolveReview, onOpenJob }: { workspace: Workspace; selectedResume: ResumeNode | null; onSelect: (id: string) => void; onUpload: () => void; onDownload: (resume: ResumeNode) => void; onDelete: (resume: ResumeNode) => void; onReparent: (resume: ResumeNode, parentId: string | null) => void; onReanalyze: (resume: ResumeNode) => void; onMergeChanges: (firstId: string, secondId: string) => void; onUpdateDiff: (item: DiffItem) => void; onUpdateReview: (item: ReviewItem) => void; onResolveReview: (id: string, resolution: "modified" | "split") => void; onOpenJob: (id: string) => void }) {
  const [parentVisible, setParentVisible] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [versionListVisible, setVersionListVisible] = useState(true);
  const [focusedChange, setFocusedChange] = useState<string | null>(null);
  const report = selectedResume ? getDiffForResume(workspace, selectedResume.id) : null;
  const jobs = selectedResume ? linkedJobs(workspace, selectedResume.id) : [];
  const parent = selectedResume ? workspace.resumes.find((item) => item.id === selectedResume.parentId) : null;
  const analyses = selectedResume ? workspace.aiAnalyses.filter((item) => item.resumeId === selectedResume.id) : [];
  const selectVersion = (id: string) => { setParentVisible(false); setListOpen(false); setFocusedChange(null); onSelect(id); };
  const focusChange = (id: string) => {
    setListOpen(true); setFocusedChange(id);
    setTimeout(() => document.getElementById(`diff-${id}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 80);
    setTimeout(() => setFocusedChange(null), 1800);
  };
  return <div className="page-shell">
    <div className="page-heading"><div><p className="eyebrow">RESUME LIBRARY</p><h1>简历不是文件堆，而是一条演化路径</h1><p>保存原文件，追踪父子版本，并确认每一处真实变化。</p></div><button className="primary large" onClick={onUpload}>＋ 上传新简历</button></div>
    {workspace.resumes.length === 0 ? <EmptyPanel title="上传第一份简历" text="DOCX 优先识别，也支持文本型 PDF。原文件仅保存在当前浏览器。" action="选择 Word 或 PDF" onAction={onUpload} /> : <div className={`split-layout resume-layout ${versionListVisible ? "" : "resume-list-collapsed"}`}>
      {versionListVisible && <section className="list-panel"><div className="panel-title"><h2>全部版本</h2><div><span>{workspace.resumes.length}</span><button onClick={() => setVersionListVisible(false)}>收起</button></div></div>{workspace.resumes.map((resume) => <button className={`resume-row ${selectedResume?.id === resume.id ? "selected" : ""}`} key={resume.id} onClick={() => selectVersion(resume.id)}><span className={`file-badge ${resume.fileType}`}>{resume.fileType}</span><span><strong>{resume.name}</strong><small>{resume.parentId ? "派生版本" : "根简历"} · {formatDate(resume.updatedAt)}</small></span></button>)}</section>}
      <section className="detail-panel">{selectedResume ? <>
        <div className="detail-header"><div><span className="status-chip">{selectedResume.parentId ? `基于 ${parent?.name ?? "未知版本"}` : "根简历"}</span><h2>{selectedResume.name}</h2><p>{selectedResume.filename} · {(selectedResume.fileSize / 1024).toFixed(0)} KB</p></div><div className="button-row">{!versionListVisible && <button onClick={() => setVersionListVisible(true)}>显示版本栏</button>}<button onClick={() => onDownload(selectedResume)}>下载原文件</button><button className="danger-text" onClick={() => onDelete(selectedResume)}>永久删除</button></div></div>
        {selectedResume.parseWarnings.length > 0 && <div className="warning-box">{selectedResume.parseWarnings.map((warning) => <p key={warning}>识别提示：{warning}</p>)}</div>}
        <label className="parent-picker">父版本<select value={selectedResume.parentId ?? ""} onChange={(event) => onReparent(selectedResume, event.target.value || null)}><option value="">设为根简历</option>{workspace.resumes.filter((item) => item.id !== selectedResume.id).map((item) => <option key={item.id} value={item.id} disabled={!canAssignParent(workspace, selectedResume.id, item.id)}>{item.name}</option>)}</select><small>修改父版本后，差异会重新计算；已有 AI 分析会被移除。</small></label>
        <div className="detail-section"><div className="section-heading"><h3>关联岗位</h3><span>{jobs.length} 个</span></div><div className="tag-row">{jobs.length ? jobs.map((job) => <button className="job-tag" key={job.id} onClick={() => onOpenJob(job.id)}>{job.company}｜{job.role}</button>) : <span className="quiet-box">这份简历尚未关联岗位</span>}</div></div>
        <div className="detail-section"><div className="section-heading"><h3>{report ? "相对父版本的变化" : "结构化简历"}</h3><span>{report ? `${report.items.length} 处${report.reviewItems.length ? ` · ${report.reviewItems.length} 项待确认` : ""}` : "当前版本"}</span></div>{!report ? <StructuredResume sections={buildStructuredDocument(selectedResume.blocks)} /> : <>
          {report.algorithmVersion < 3 && <div className="legacy-diff-notice"><div><strong>可使用新版规则重新识别</strong><p>新版能识别“核心能力”等栏目别名，并生成结构化父子对比；旧结果不会自动覆盖。</p></div><button onClick={() => onReanalyze(selectedResume)}>使用新版规则重新识别</button></div>}
          <button className="diff-list-toggle" aria-expanded={listOpen} onClick={() => setListOpen((value) => !value)}>{listOpen ? "收起变化清单" : `展开变化清单（${report.items.length + report.reviewItems.length}）`}</button>
          {listOpen && <div className="change-list-panel">{report.reviewItems.length > 0 && <section className="review-group"><div className="diff-group-heading"><div><h4>需要你确认的匹配</h4><p>系统无法确定两段是否属于同一项经历；确认后才会进入正式差异和 AI 分析。</p></div><span>{report.reviewItems.length}</span></div><div className="diff-list">{report.reviewItems.map((item) => <ReviewCard key={item.id} item={item} onChange={onUpdateReview} onResolve={onResolveReview} />)}</div></section>}{report.items.length === 0 && report.reviewItems.length === 0 ? <p className="quiet-box">没有识别到内容变化。</p> : <DiffGroups report={report} analyses={analyses.flatMap((analysis) => analysis.items)} focusedId={focusedChange} onMerge={onMergeChanges} onChange={onUpdateDiff} />}</div>}
          {report.algorithmVersion === 3 ? <><div className="annotated-toolbar"><div><strong>标注后的当前版本</strong><span>点击变化标签可定位详细清单</span></div><button onClick={() => setParentVisible((value) => !value)}>{parentVisible ? "收起父版本" : "显示父版本"}</button></div><AnnotatedComparison report={report} parentVisible={parentVisible} onFocus={focusChange} /></> : <StructuredResume sections={buildStructuredDocument(selectedResume.blocks)} />}
        </>}</div>
      </> : <div className="detail-placeholder">选择一份简历查看版本详情</div>}</section>
    </div>}
  </div>;
}

function StructuredResume({ sections }: { sections: StructuredSection[] }) {
  return <div className="structured-resume">{sections.map((section) => <section key={section.key}><h4>{section.title}</h4>{section.units.map((unit) => <div className="structured-unit" key={unit.id}>{unit.text}</div>)}</section>)}</div>;
}

function AnnotatedComparison({ report, parentVisible, onFocus }: { report: DiffReport; parentVisible: boolean; onFocus: (id: string) => void }) {
  const sectionDiffs = report.items.filter((item) => item.level === "section");
  const rows = report.alignmentRows;
  return <div className={`annotated-compare ${parentVisible ? "with-parent" : "current-only"}`}>{parentVisible && <div className="compare-column-label parent-label">父版本</div>}<div className="compare-column-label">当前版本</div>{rows.map((row, index) => {
    const firstSection = index === 0 || rows[index - 1].sectionKey !== row.sectionKey;
    const rowItems = row.diffItemIds.map((id) => report.items.find((item) => item.id === id)).filter(Boolean) as DiffItem[];
    const sectionItems = firstSection ? sectionDiffs.filter((item) => item.section === row.afterSectionTitle || item.before === row.beforeSectionTitle) : [];
    const markers = [...sectionItems, ...rowItems];
    return <div className="compare-row" key={row.id}>{parentVisible && <AnnotatedUnit side="before" unit={row.beforeUnit} sectionTitle={row.beforeSectionTitle} firstSection={firstSection} markers={markers} onFocus={onFocus} />}<AnnotatedUnit side="after" unit={row.afterUnit} sectionTitle={row.afterSectionTitle} firstSection={firstSection} markers={markers} onFocus={onFocus} /></div>;
  })}</div>;
}

function AnnotatedUnit({ side, unit, sectionTitle, firstSection, markers, onFocus }: { side: "before" | "after"; unit: AlignmentRow["beforeUnit"]; sectionTitle: string; firstSection: boolean; markers: DiffItem[]; onFocus: (id: string) => void }) {
  const visible = markers.filter((item) => side === "before" ? item.kind !== "added" : item.kind !== "removed");
  const contentMarkers = visible.filter((item) => item.level !== "section" && item.kind !== "modified");
  return <div className={`annotated-unit ${unit ? "" : "placeholder"}`}>{firstSection && <div className="annotated-section-title"><strong>{sectionTitle}</strong>{visible.filter((item) => item.level === "section").map((item) => <button key={item.id} onClick={() => onFocus(item.id)}>{DIFF_LABELS[item.kind]}</button>)}</div>}{unit ? <div className={`annotated-content ${visible.length ? "changed" : ""}`}>{contentMarkers.length > 0 && <div className="marker-row">{contentMarkers.map((item) => <button key={item.id} onClick={() => onFocus(item.id)}>{DIFF_LABELS[item.kind]}</button>)}</div>}<p>{unit.text}</p></div> : <button className="missing-unit" onClick={() => markers[0] && onFocus(markers[0].id)}>{side === "before" ? "此前无此内容" : "当前版本已删除"}</button>}</div>;
}

function GraphView({ workspace, selectedId, onSelect, onOpen, onUpload }: { workspace: Workspace; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void; onUpload: () => void }) {
  const [scale, setScale] = useState(1);
  const roots = workspace.resumes.filter((item) => !item.parentId);
  const maxDepth = Math.max(1, ...workspace.resumes.map((resume) => depthOf(workspace, resume)));
  return <div className="graph-page"><div className="graph-toolbar"><div><p className="eyebrow">RESUME LINEAGE</p><h1>简历谱系</h1><p>节点位置由父子关系自动生成；点击查看，双击进入详情。</p></div><div className="zoom-controls"><button onClick={() => setScale((value) => Math.max(.6, value - .1))}>−</button><span>{Math.round(scale * 100)}%</span><button onClick={() => setScale((value) => Math.min(1.6, value + .1))}>＋</button><button onClick={() => setScale(1)}>复位</button></div></div>{workspace.resumes.length === 0 ? <EmptyPanel title="还没有简历节点" text="上传第一份简历后，它会成为谱系中的根节点。" action="上传第一份简历" onAction={onUpload} /> : <div className="graph-viewport"><div className="graph-canvas" style={{ transform: `scale(${scale})`, minWidth: `${Math.max(900, maxDepth * 300)}px` }}>{roots.map((root) => <GraphBranch key={root.id} node={root} workspace={workspace} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} />)}</div></div>}</div>;
}

function GraphBranch({ node, workspace, selectedId, onSelect, onOpen }: { node: ResumeNode; workspace: Workspace; selectedId: string | null; onSelect: (id: string) => void; onOpen: (id: string) => void }) {
  const children = workspace.resumes.filter((item) => item.parentId === node.id);
  const diff = getDiffForResume(workspace, node.id);
  const jobs = linkedJobs(workspace, node.id);
  return <div className="graph-branch"><button className={`graph-node ${selectedId === node.id ? "selected" : ""}`} onClick={() => onSelect(node.id)} onDoubleClick={() => onOpen(node.id)}><span className={`file-badge ${node.fileType}`}>{node.fileType}</span><strong>{node.name}</strong><small>{jobs.length} 个岗位 · {diff?.items.length ?? 0} 处改动</small><em>{formatDate(node.updatedAt)}</em></button>{children.length > 0 && <div className="graph-children">{children.map((child) => <GraphBranch key={child.id} node={child} workspace={workspace} selectedId={selectedId} onSelect={onSelect} onOpen={onOpen} />)}</div>}</div>;
}

function depthOf(workspace: Workspace, resume: ResumeNode) { let depth = 1; let current = resume; const seen = new Set<string>(); while (current.parentId && !seen.has(current.id)) { seen.add(current.id); const parent = workspace.resumes.find((item) => item.id === current.parentId); if (!parent) break; depth += 1; current = parent; } return depth; }

function DiffGroups({ report, analyses, focusedId, onMerge, onChange }: { report: DiffReport; analyses: AiAnalysisItem[]; focusedId: string | null; onMerge: (firstId: string, secondId: string) => void; onChange: (item: DiffItem) => void }) {
  return <div className="diff-groups">{DIFF_GROUPS.map((group) => {
    const items = report.items.filter((item) => item.kind === group.kind);
    if (!items.length) return null;
    return <section className={`diff-group diff-group-${group.kind}`} key={group.kind}><div className="diff-group-heading"><div><h4>{DIFF_LABELS[group.kind]}</h4><p>{group.description}</p></div><span>{items.length}</span></div><div className="diff-list">{items.map((item) => <DiffCard key={item.id} item={item} report={report} focused={focusedId === item.id} analysis={analyses.find((entry) => entry.diffItemId === item.id)} onMerge={onMerge} onChange={onChange} />)}</div></section>;
  })}</div>;
}

function ReorderLines({ value }: { value: string }) {
  return <ol className="reorder-lines">{value.split(/\n{2,}/).filter(Boolean).map((entry, index) => <li key={`${entry}-${index}`}><span>{index + 1}</span><p>{entry}</p></li>)}</ol>;
}

function DiffCard({ item, report, focused, analysis, onMerge, onChange }: { item: DiffItem; report: DiffReport; focused: boolean; analysis?: AiAnalysisItem; onMerge: (firstId: string, secondId: string) => void; onChange: (item: DiffItem) => void }) {
  const reorder = item.kind === "reordered";
  const counterpart = item.kind === "added" ? "removed" : item.kind === "removed" ? "added" : null;
  const candidates = counterpart ? report.items.filter((entry) => entry.kind === counterpart).sort((a, b) => similarity(item.after || item.before, b.after || b.before) - similarity(item.after || item.before, a.after || a.before)) : [];
  return <article id={`diff-${item.id}`} className={`diff-card diff-${item.kind} ${focused ? "diff-focused" : ""}`}><header><span>{DIFF_LABELS[item.kind]}</span><strong>{item.section}</strong>{item.kind === "modified" && <em>{item.source === "user" ? "用户确认" : `识别置信度 ${Math.round(item.confidence * 100)}%`}</em>}</header>{item.before && <div className="diff-line before"><small>{item.kind === "removed" ? "删除内容" : reorder ? "原顺序" : "修改前"}</small>{reorder ? <ReorderLines value={item.before} /> : <p>{item.before}</p>}</div>}{item.after && <div className="diff-line after"><small>{item.kind === "added" ? "新增内容" : reorder ? "新顺序" : "修改后"}</small>{reorder ? <ReorderLines value={item.after} /> : <p>{item.after}</p>}</div>}{candidates.length > 0 && <label className="merge-field"><span>其实是改写？</span><select defaultValue="" onChange={(event) => { if (event.target.value) onMerge(item.id, event.target.value); event.currentTarget.value = ""; }}><option value="">选择对应的{counterpart === "removed" ? "删除" : "新增"}项合并…</option>{candidates.map((candidate) => <option value={candidate.id} key={candidate.id}>{candidate.section} · {(candidate.before || candidate.after).slice(0, 42)}</option>)}</select></label>}{item.keywordMatches.length > 0 && <div className="keyword-row"><small>关键词推断</small>{item.keywordMatches.map((word) => <span key={word}>{word}</span>)}</div>}<label className="note-field">你的备注<input value={item.note} onChange={(event) => onChange({ ...item, note: event.target.value })} placeholder="例如：为了突出增长结果" /></label>{analysis && <div className="ai-result"><span>DeepSeek 分析 · {Math.round(analysis.confidence * 100)}%</span><p><strong>修改意图：</strong>{analysis.intent}</p><p><strong>JD 对应：</strong>{analysis.jdRequirement}</p><p><strong>建议：</strong>{analysis.recommendation}</p></div>}</article>;
}

function ReviewCard({ item, onChange, onResolve }: { item: ReviewItem; onChange: (item: ReviewItem) => void; onResolve: (id: string, resolution: "modified" | "split") => void }) {
  return <article className="diff-card review-card"><header><span>待确认</span><strong>{item.section}</strong><em>识别置信度 {Math.round(item.confidence * 100)}%</em></header><p className="review-reason">{item.reason}</p><div className="diff-line before"><small>可能对应</small><p>{item.before}</p></div><div className="diff-line after"><small>当前内容</small><p>{item.after}</p></div><label className="note-field">你的备注<input value={item.note} onChange={(event) => onChange({ ...item, note: event.target.value })} placeholder="可记录你的判断依据" /></label><div className="review-actions"><button className="primary" onClick={() => onResolve(item.id, "modified")}>确认为改写</button><button onClick={() => onResolve(item.id, "split")}>拆成删除＋新增</button></div></article>;
}

function Onboarding({ onUpload, onJob, onClose }: { onUpload: () => void; onJob: () => void; onClose: () => void }) { return <Modal onClose={onClose} className="onboarding"><p className="eyebrow">WELCOME TO RESUME GRAPH</p><h2>从你手头已有的东西开始</h2><p>你可以先建立简历谱系，也可以先保存一个准备投递的岗位。</p><div className="choice-grid"><button onClick={onUpload}><span className="choice-icon">↥</span><strong>上传第一份简历</strong><small>支持 DOCX 和文本型 PDF，文件只存在当前浏览器</small></button><button onClick={onJob}><span className="choice-icon">◎</span><strong>保存第一个岗位 JD</strong><small>记录完整 JD、截止时间和下一步行动</small></button></div><button className="text-button" onClick={onClose}>稍后再说，先看看界面</button></Modal>; }

function JobModal({ job, onChange, onSave, onClose }: { job: Job; onChange: (job: Job) => void; onSave: () => void; onClose: () => void }) { return <Modal onClose={onClose} className="form-modal"><p className="eyebrow">JOB SNAPSHOT</p><h2>{job.company ? "编辑岗位" : "保存岗位 JD"}</h2><div className="form-grid two"><Field label="公司" value={job.company} onChange={(company) => onChange({ ...job, company })} /><Field label="岗位" value={job.role} onChange={(role) => onChange({ ...job, role })} /></div><Field label="岗位来源链接" value={job.sourceUrl} onChange={(sourceUrl) => onChange({ ...job, sourceUrl })} /><div className="form-grid two"><label className="field"><span>当前阶段</span><select value={job.status} onChange={(event) => onChange({ ...job, status: event.target.value as JobStatus })}>{JOB_STATUSES.map((status) => <option key={status}>{status}</option>)}</select></label><Field label="截止时间" value={job.deadline} onChange={(deadline) => onChange({ ...job, deadline })} type="date" /></div><Field label="下一步行动" value={job.nextAction} onChange={(nextAction) => onChange({ ...job, nextAction })} placeholder="例如：周五前完成定制版简历" /><Field label="完整 JD" value={job.jdText} onChange={(jdText) => onChange({ ...job, jdText })} multiline rows={10} /><Field label="备注" value={job.notes} onChange={(notes) => onChange({ ...job, notes })} multiline rows={3} /><div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={onSave}>保存岗位</button></div></Modal>; }

function UploadModal({ draft, resumes, jobs, onChange, onSave, onClose }: { draft: UploadDraft; resumes: ResumeNode[]; jobs: Job[]; onChange: (draft: UploadDraft) => void; onSave: () => void; onClose: () => void }) {
  const extractionQuality = assessExtractedText(draft.extractedText);
  return <Modal onClose={onClose} className="upload-modal"><p className="eyebrow">LOCAL PARSING</p><h2>确认新简历的识别结果</h2><div className="file-summary"><span className={`file-badge ${draft.fileType}`}>{draft.fileType}</span><div><strong>{draft.file.name}</strong><small>{(draft.file.size / 1024).toFixed(0)} KB · 原文件不会上传</small></div></div>{draft.warnings.length > 0 && <div className="warning-box">{draft.warnings.map((item) => <p key={item}>{item}</p>)}</div>}{!extractionQuality.usable && <div className="extraction-error" role="alert"><strong>这份文件的文字暂时无法可靠识别</strong><p>{extractionQuality.reasons.join("；")}。PDF 页面可能看起来正常，但内嵌字体没有提供正确的文字映射。</p><p>请优先上传原始 DOCX，或从 Word / WPS 重新导出 PDF；也可以在下方删除乱码并粘贴正确文本后继续。</p></div>}<Field label="版本名称" value={draft.name} onChange={(name) => onChange({ ...draft, name })} /><label className="field"><span>父版本</span><select value={draft.parentId} onChange={(event) => onChange({ ...draft, parentId: event.target.value })}>{resumes.length > 0 && <option value="pending">请选择</option>}<option value="">这是新的根简历</option>{resumes.map((resume) => <option key={resume.id} value={resume.id}>{resume.name}</option>)}</select><small>已有简历时请选择它基于哪一版修改；没有父版本也可以作为新的根节点。</small></label>{jobs.length > 0 && <fieldset className="check-field"><legend>关联岗位（可多选）</legend>{jobs.map((job) => <label key={job.id}><input type="checkbox" checked={draft.jobIds.includes(job.id)} onChange={(event) => onChange({ ...draft, jobIds: event.target.checked ? [...draft.jobIds, job.id] : draft.jobIds.filter((id) => id !== job.id) })} />{job.company}｜{job.role}</label>)}</fieldset>}<Field label="提取文本（请检查，可修正）" value={draft.extractedText} onChange={(extractedText) => onChange({ ...draft, extractedText })} multiline rows={14} /><p className="modal-note">修正提取文本不会改变原始 Word / PDF 文件。保存后将根据父版本生成结构化差异。</p><div className="modal-actions"><button onClick={onClose}>取消</button><button className="primary" onClick={onSave} disabled={!extractionQuality.usable} title={extractionQuality.usable ? undefined : "请先粘贴可识别的正确文本"}>保存并识别差异</button></div></Modal>;
}

function AiSettingsModal({ settings, testing, onChange, onTest, onSave, onClear, onClose }: { settings: AiSettings; testing: boolean; onChange: (settings: AiSettings) => void; onTest: () => void; onSave: () => void; onClear: () => void; onClose: () => void }) {
  return <Modal onClose={onClose} className="ai-settings-modal"><p className="eyebrow">PRIVATE AI CONNECTION</p><h2>DeepSeek API 设置</h2><p className="modal-note">API Key 不会写入网站代码或工作区备份。分析时，父子简历、已确认差异和当前 JD 会通过本站代理发送给 DeepSeek。</p><div className="ai-endpoint"><span>固定接口</span><code>https://api.deepseek.com/chat/completions</code></div><Field label="API Key" value={settings.apiKey} onChange={(apiKey) => onChange({ ...settings, apiKey })} type="password" placeholder="sk-…" /><Field label="模型名称" value={settings.model} onChange={(model) => onChange({ ...settings, model })} placeholder="deepseek-v4-flash" /><div className="setting-check"><input id="ai-anonymize" aria-labelledby="ai-anonymize-label" type="checkbox" checked={settings.anonymize} onChange={(event) => onChange({ ...settings, anonymize: event.target.checked })} /><span><strong id="ai-anonymize-label">分析前隐藏常见联系方式</strong><small>自动替换邮箱和电话号码；公司、学校、姓名及经历内容仍会发送。</small></span></div><div className="setting-check"><input id="ai-remember" aria-labelledby="ai-remember-label" type="checkbox" checked={settings.remember} onChange={(event) => onChange({ ...settings, remember: event.target.checked })} /><span><strong id="ai-remember-label">在当前浏览器记住 API Key</strong><small>关闭后只保留到本次浏览器会话结束；完整备份始终不包含 Key。</small></span></div><div className="modal-actions ai-settings-actions">{settings.apiKey && <button className="danger-text" onClick={onClear}>清除 Key</button>}<button onClick={onTest} disabled={testing}>{testing ? "测试中…" : "测试连接"}</button><button className="primary" onClick={onSave}>保存设置</button></div></Modal>;
}

function Modal({ children, onClose, className = "" }: { children: React.ReactNode; onClose: () => void; className?: string }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className={`modal ${className}`} role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="关闭">×</button>{children}</section></div>; }
function Field({ label, value, onChange, multiline = false, rows = 3, placeholder = "", type = "text" }: { label: string; value: string; onChange: (value: string) => void; multiline?: boolean; rows?: number; placeholder?: string; type?: string }) { return <label className="field"><span>{label}</span>{multiline ? <textarea value={value} rows={rows} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} /> : <input type={type} value={value} placeholder={placeholder} onChange={(event) => onChange(event.target.value)} />}</label>; }
function Metric({ value, label }: { value: number; label: string }) { return <div className="metric"><strong>{value}</strong><span>{label}</span></div>; }
function EmptyPanel({ title, text, action, onAction }: { title: string; text: string; action: string; onAction: () => void }) { return <div className="empty-panel"><div className="empty-orbit"><i /><i /><i /></div><h2>{title}</h2><p>{text}</p><button className="primary" onClick={onAction}>{action}</button></div>; }
