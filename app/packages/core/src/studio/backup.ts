import { CheckRepoActions, simpleGit } from "simple-git";

/**
 * 작업 공간 백업 — 작업 공간 안의 git(비공개 백업 레포)에 지금 상태를 커밋하고 원격에 올린다
 * (사용자 결정 2026-10-14, 저장구조.md 1절). 커널은 git으로 무엇도 추측하지 않는다(원칙 15) —
 * 사람이나 호스트가 `patchbay backup` 을 부를 때만 돈다.
 */
export interface BackupResult {
  committed: boolean;
  commit?: string;
  changed: number;
  pushed: boolean;
  note?: string;
}

export async function backupStudio(
  studioHome: string,
  options: { message?: string; push?: boolean; now?: Date } = {},
): Promise<BackupResult> {
  const git = simpleGit(studioHome);
  const isRepo = await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT).catch(() => false);
  if (!isRepo) throw new Error(`작업 공간이 git 레포가 아니다: ${studioHome}. 백업 레포를 먼저 붙인다(저장구조.md).`);

  await git.add(["-A"]);
  const staged = (await git.diff(["--cached", "--name-only"])).split("\n").filter(Boolean);
  let commit: string | undefined;
  if (staged.length > 0) {
    const stamp = (options.now ?? new Date()).toISOString();
    const result = await git.commit(options.message?.trim() || `작업 공간 백업 ${stamp}`);
    commit = result.commit || undefined;
  }

  if (options.push === false) {
    return { committed: Boolean(commit), ...(commit ? { commit } : {}), changed: staged.length, pushed: false };
  }
  const remotes = await git.getRemotes();
  if (!remotes.some((remote) => remote.name === "origin")) {
    return { committed: Boolean(commit), ...(commit ? { commit } : {}), changed: staged.length, pushed: false, note: "원격 origin 없음 — 커밋만 했다" };
  }
  const branch = (await git.revparse(["--abbrev-ref", "HEAD"])).trim();
  await git.push("origin", branch);
  return { committed: Boolean(commit), ...(commit ? { commit } : {}), changed: staged.length, pushed: true };
}
