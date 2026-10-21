import { readStudio, resolveProjectAlias, resolveStudioHome, writeExistingLink } from "@patchbay/core";
import { printError, printResult } from "../output.js";

export interface BuildLinkCommandOptions {
  project?: string;
  requirement?: string;
  file?: string;
  test?: string;
  code?: string;
  json?: boolean;
}

/**
 * `patchbay build link --project <alias> --requirement <id> --file <test file> [--test "describe > it"] [--code <file>]`
 *
 * 「이미 구현됨」 길의 에이전트 제안 (사용자 결정 2026-10-20). 여기서 넣은 연결은 **제안**이다 —
 * 사람이 2 구현 화면에서 「확인」을 눌러야 판정에 쓰인다. 사람이 화면에서 넣는 연결은 바로 확인된 연결이다.
 */
export async function runBuildLink(
  options: BuildLinkCommandOptions,
  studioHome: string = resolveStudioHome(),
): Promise<number> {
  const json = Boolean(options.json);
  const resolution = resolveProjectAlias(await readStudio(studioHome), options.project);
  if (!resolution.ok) {
    printError(json, resolution.message);
    return 1;
  }
  if (!options.requirement || !options.file) {
    printError(json, "build link: --requirement 와 --file 이 필요하다.");
    return 1;
  }
  try {
    const link = await writeExistingLink(studioHome, resolution.alias, {
      requirement: options.requirement,
      file: options.file,
      test: options.test,
      code: options.code,
      by: "agent",
    });
    printResult(json, { ok: true, link }, [
      `${link.state === "confirmed" ? "이미 확인된 연결" : "제안했다"} — ${link.requirement} → ${link.file}${link.test ? ` › ${link.test}` : ""}`,
    ]);
    return 0;
  } catch (error) {
    printError(json, `build link: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
