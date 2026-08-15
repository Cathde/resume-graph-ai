import { openDB } from "idb";
import JSZip from "jszip";
import { emptyWorkspace, validateWorkspace } from "./model";
import type { Workspace } from "./model";

const DB_NAME = "resume-graph-v1";
const WORKSPACE_KEY = "workspace";

async function db() {
  return openDB(DB_NAME, 1, {
    upgrade(database) {
      database.createObjectStore("workspace");
      database.createObjectStore("files");
    },
  });
}

export async function loadWorkspace() {
  const stored = await (await db()).get("workspace", WORKSPACE_KEY) as Workspace | undefined;
  return stored ? validateWorkspace(stored) : emptyWorkspace();
}

export async function saveWorkspace(workspace: Workspace) {
  await (await db()).put("workspace", workspace, WORKSPACE_KEY);
}

export async function saveFile(fileId: string, file: Blob) {
  await (await db()).put("files", file, fileId);
}

export async function getFile(fileId: string) {
  return await (await db()).get("files", fileId) as Blob | undefined;
}

export async function deleteFile(fileId: string) {
  await (await db()).delete("files", fileId);
}

export async function exportBackup(workspace: Workspace) {
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(workspace, null, 2));
  for (const resume of workspace.resumes) {
    const file = await getFile(resume.fileId);
    if (!file) throw new Error(`缺少原文件：${resume.filename}`);
    zip.file(`files/${resume.fileId}/${resume.filename.replace(/[\\/:*?"<>|]/g, "-")}`, file);
  }
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export async function importBackup(blob: Blob) {
  const zip = await JSZip.loadAsync(blob);
  const manifestEntry = zip.file("manifest.json");
  if (!manifestEntry) throw new Error("备份中缺少 manifest.json");
  const workspace = validateWorkspace(JSON.parse(await manifestEntry.async("string")));
  const recovered = new Map<string, Blob>();
  for (const resume of workspace.resumes) {
    const prefix = `files/${resume.fileId}/`;
    const entry = Object.values(zip.files).find((file) => !file.dir && file.name.startsWith(prefix));
    if (!entry) throw new Error(`备份中缺少原文件：${resume.filename}`);
    recovered.set(resume.fileId, await entry.async("blob"));
  }
  const database = await db();
  const transaction = database.transaction(["workspace", "files"], "readwrite");
  await transaction.objectStore("files").clear();
  for (const [id, file] of recovered) await transaction.objectStore("files").put(file, id);
  await transaction.objectStore("workspace").put(workspace, WORKSPACE_KEY);
  await transaction.done;
  return workspace;
}

export async function clearAllData() {
  const database = await db();
  const transaction = database.transaction(["workspace", "files"], "readwrite");
  await Promise.all([transaction.objectStore("workspace").clear(), transaction.objectStore("files").clear()]);
  await transaction.done;
}
