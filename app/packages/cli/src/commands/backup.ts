import { backupStudio, requireStudioHome } from "@patchbay/core";
import { printResult } from "../output.js";

export interface BackupOptions {
  message?: string;
  push?: boolean;
  json?: boolean;
}

/** `patchbay backup [--message <m>] [--no-push]` — 작업 공간을 백업 레포에 커밋하고 올린다. */
export async function runBackup(options: BackupOptions, studioHome: string = requireStudioHome()): Promise<number> {
  const result = await backupStudio(studioHome, {
    ...(options.message ? { message: options.message } : {}),
    push: options.push !== false,
  });
  const lines = [
    result.committed ? `커밋 ${result.commit?.slice(0, 7)} — 바뀐 파일 ${result.changed}개` : "바뀐 것 없음 — 커밋하지 않았다",
    result.pushed ? "원격에 올렸다" : (result.note ?? "올리지 않았다 (--no-push)"),
  ];
  printResult(Boolean(options.json), { ok: true, studioHome, ...result }, lines);
  return 0;
}
