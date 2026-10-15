import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { beforeEach, describe, expect, it } from "vitest";

/**
 * Integration tests (spec Phase 3's test-strategy note for `packages/cli`):
 * spawn the *built* CLI (`dist/index.js`) against fixture directories, with
 * `PATCHBAY_HOME` pointed at a fresh OS tmpdir in the child's env -- never
 * the real `~/.patchbay`. Requires `pnpm build` to have run first; the
 * package's `pretest` script does this automatically.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.resolve(__dirname, "..", "dist", "index.js");

let studioHome: string;

beforeEach(() => {
  studioHome = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-integration-home-"));
});

function runCli(args: string[]) {
  return execa("node", [CLI_ENTRY, ...args], {
    env: { ...process.env, PATCHBAY_HOME: studioHome },
    reject: false,
  });
}

function buildFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-integration-fixture-"));
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: "pipe" });
  fs.writeFileSync(path.join(dir, "README.md"), "# Fixture\n");
  fs.mkdirSync(path.join(dir, "src"));
  fs.writeFileSync(path.join(dir, "src", "index.ts"), "export {};\n");
  run("git init -q -b main");
  run("git config user.name 'Patchbay Test'");
  run("git config user.email test@patchbay.invalid");
  run("git add -A");
  run('git commit -q -m "initial commit"');
  run('git commit -q --allow-empty -m "second distinct commit"');
  return dir;
}

describe("patchbay CLI (built binary)", () => {
  it("init exits 0 and writes studio.yaml", async () => {
    const result = await runCli(["init", "--name", "Integration Studio"]);
    expect(result.exitCode).toBe(0);
    expect(fs.existsSync(path.join(studioHome, "studio.yaml"))).toBe(true);
  });

  it("project add: no --path -> exit 1, never prompts (stdin is not a TTY under execa)", async () => {
    const result = await runCli(["project", "add"]);
    expect(result.exitCode).toBe(1);
  });

  it("project add: nonexistent --path -> exit 1", async () => {
    const result = await runCli(["project", "add", "--path", path.join(studioHome, "nope")]);
    expect(result.exitCode).toBe(1);
  });

  it("project add: success -> exit 0, prints ATLAS.md's absolute path, file exists with the fixed headings", async () => {
    const projectDir = buildFixtureRepo();
    const result = await runCli(["project", "add", "--path", projectDir, "--json"]);
    expect(result.exitCode).toBe(0);

    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(path.isAbsolute(payload.atlasPath)).toBe(true);
    expect(fs.existsSync(payload.atlasPath)).toBe(true);

    const atlas = fs.readFileSync(payload.atlasPath, "utf8");
    expect(atlas).toContain("## 스킬");
    expect(atlas).toContain("## 규칙");
    expect(atlas).toContain("## 분류 안 된 항목");
  });

  it("project add: clarity score below threshold -> exit 2, not registered", async () => {
    const lowClarityDir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-integration-low-"));
    fs.writeFileSync(path.join(lowClarityDir, "notes.txt"), "no readme, no git\n");

    const result = await runCli(["project", "add", "--path", lowClarityDir, "--json"]);
    expect(result.exitCode).toBe(2);

    // Error-shaped output (including the --json form) goes to stderr, not
    // stdout -- a deliberate, consistent choice: stdout carries only
    // successful-command payloads (e.g. the ATLAS.md path on success).
    const payload = JSON.parse(result.stderr);
    expect(payload.ok).toBe(false);
    expect(payload.score).toBeLessThan(40);

    // Nothing was ever registered, so studio.yaml may not even exist yet --
    // and if it does (e.g. a prior successful add in this test), it must
    // not mention the rejected project's path.
    const studioYamlPath = path.join(studioHome, "studio.yaml");
    if (fs.existsSync(studioYamlPath)) {
      expect(fs.readFileSync(studioYamlPath, "utf8")).not.toContain(lowClarityDir);
    }
  });

  it("project new: no --path -> exit 1", async () => {
    const result = await runCli(["project", "new", "demo"]);
    expect(result.exitCode).toBe(1);
  });

  it("project triage: no --path -> exit 1", async () => {
    const result = await runCli(["project", "triage"]);
    expect(result.exitCode).toBe(1);
  });

  it("project triage: writes excavation.json in the target folder and never registers it with the studio", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-integration-triage-"));
    fs.writeFileSync(path.join(dir, "notes_backup.md"), "TODO: sort this out\n");

    const result = await runCli(["project", "triage", "--path", dir, "--json"]);
    expect(result.exitCode).toBe(0);

    const printed = JSON.parse(result.stdout);
    expect(printed.excavationPath).toBe(path.join(dir, "excavation.json"));
    expect(fs.existsSync(printed.excavationPath)).toBe(true);
    expect(fs.existsSync(path.join(studioHome, "studio.yaml"))).toBe(false);
  });

  it("scan + atlas round trip against a registered project", async () => {
    const projectDir = buildFixtureRepo();
    const addResult = await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);
    expect(addResult.exitCode).toBe(0);

    const scanResult = await runCli(["scan", "--project", "demo"]);
    expect(scanResult.exitCode).toBe(0);

    const atlasResult = await runCli(["atlas", "--project", "demo"]);
    expect(atlasResult.exitCode).toBe(0);
    expect(atlasResult.stdout).toContain("- source:README.md");
  });

  it("atlas: unregistered alias -> exit 1", async () => {
    const result = await runCli(["atlas", "--project", "nope"]);
    expect(result.exitCode).toBe(1);
  });

  it("atlas --level 1/2/3 print the digest, ATLAS.md, and raw inferred.json respectively", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const l2Default = await runCli(["atlas", "--project", "demo"]);
    const l2Explicit = await runCli(["atlas", "--project", "demo", "--level", "2"]);
    expect(l2Default.exitCode).toBe(0);
    expect(l2Explicit.exitCode).toBe(0);
    expect(l2Explicit.stdout).toBe(l2Default.stdout);
    expect(l2Default.stdout).toContain("## 스킬");

    const l1 = await runCli(["atlas", "--project", "demo", "--level", "1"]);
    expect(l1.exitCode).toBe(0);
    expect(l1.stdout).toContain("규칙: 1");
    expect(l1.stdout).not.toContain("## 스킬");

    const l3 = await runCli(["atlas", "--project", "demo", "--level", "3"]);
    expect(l3.exitCode).toBe(0);
    const parsed = JSON.parse(l3.stdout);
    expect(parsed.discoveredPorts).toContain("source:README.md");
  });

  it("atlas --level 9 -> exit 1, doesn't silently fall back to L2", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const result = await runCli(["atlas", "--project", "demo", "--level", "9"]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe("");
  });

  it("patch: unknown skill slug -> exit 1 (the Bay is empty until a later phase populates it)", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const result = await runCli(["patch", "nonexistent-skill", "demo"]);
    expect(result.exitCode).toBe(1);
  });

  it("patch: unregistered project alias -> exit 1", async () => {
    const slug = "demo-skill";
    fs.mkdirSync(path.join(studioHome, "skills", slug), { recursive: true });
    fs.writeFileSync(path.join(studioHome, "skills", slug, "SKILL.md"), "# Demo Skill\n");

    const result = await runCli(["patch", slug, "nope"]);
    expect(result.exitCode).toBe(1);
  });

  it("patch: installs a skill into a registered project, records the wire, and it surfaces under atlas's Gaps section", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const slug = "demo-skill";
    const bayDir = path.join(studioHome, "skills", slug);
    fs.mkdirSync(bayDir, { recursive: true });
    fs.writeFileSync(path.join(bayDir, "SKILL.md"), "# Demo Skill\n");

    const patchResult = await runCli(["patch", slug, "demo", "--json"]);
    expect(patchResult.exitCode).toBe(0);
    const payload = JSON.parse(patchResult.stdout);
    expect(payload.ok).toBe(true);
    expect(["symlink", "copy"]).toContain(payload.install);
    expect(payload.wire).toMatchObject({
      from: `skill:${slug}`,
      to: `skill:skills/${slug}/SKILL.md`,
      kind: "uses",
    });

    const installedSkillMd = path.join(projectDir, "skills", slug, "SKILL.md");
    expect(fs.existsSync(installedSkillMd)).toBe(true);
    expect(fs.readFileSync(installedSkillMd, "utf8")).toBe("# Demo Skill\n");

    // ATLAS.md is kernel-owned and only rewritten by project add/scan --
    // `patch` itself only touches overlay.yaml (spec: scans never touch
    // overlay.yaml, but a scan DOES read it to re-render Atlas/Flow), so a
    // rescan is required before the new wire shows up in ATLAS.md.
    const rescan = await runCli(["scan", "--project", "demo"]);
    expect(rescan.exitCode).toBe(0);

    // No Patch was ever declared for this -- the Wire is expected to show
    // up as "wires without a patch" in Atlas's Gaps section, not an error.
    const atlasResult = await runCli(["atlas", "--project", "demo"]);
    expect(atlasResult.exitCode).toBe(0);
    expect(atlasResult.stdout).toContain("## 빈틈");
    expect(atlasResult.stdout).toContain(`skill:${slug} --[uses]--> skill:skills/${slug}/SKILL.md`);
  });

  it("decision add: missing --project/--summary -> exit 1", async () => {
    const noProject = await runCli(["decision", "add", "--summary", "x"]);
    expect(noProject.exitCode).toBe(1);

    const noSummary = await runCli(["decision", "add", "--project", "demo"]);
    expect(noSummary.exitCode).toBe(1);
  });

  it("decision add: unregistered project alias -> exit 1", async () => {
    const result = await runCli(["decision", "add", "--project", "nope", "--summary", "x"]);
    expect(result.exitCode).toBe(1);
  });

  it("decision add: appends to overlay.yaml, defaulting concept/id/date, and doesn't clobber an existing wire", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const slug = "demo-skill";
    const bayDir = path.join(studioHome, "skills", slug);
    fs.mkdirSync(bayDir, { recursive: true });
    fs.writeFileSync(path.join(bayDir, "SKILL.md"), "# Demo Skill\n");
    await runCli(["patch", slug, "demo", "--json"]);

    const result = await runCli(["decision", "add", "--project", "demo", "--summary", "map-project를 쓰기로 함", "--json"]);
    expect(result.exitCode).toBe(0);
    const payload = JSON.parse(result.stdout);
    expect(payload.ok).toBe(true);
    expect(payload.decision).toMatchObject({ concept: "demo", summary: "map-project를 쓰기로 함" });
    expect(payload.decision.id).toBeTruthy();
    expect(payload.decision.date).toBeTruthy();

    const overlayRaw = fs.readFileSync(path.join(studioHome, "projects", "demo", "overlay.yaml"), "utf8");
    expect(overlayRaw).toContain("map-project를 쓰기로 함");
    expect(overlayRaw).toContain(`skill:${slug}`); // the earlier patch's wire is still there
  });

  it("progress: no progress recorded yet -> exit 1, both with and without --project", async () => {
    const projectDir = buildFixtureRepo();
    await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

    const noProject = await runCli(["progress"]);
    expect(noProject.exitCode).toBe(1);

    const withProject = await runCli(["progress", "--project", "demo", "--level", "2"]);
    expect(withProject.exitCode).toBe(1);
  });

  it("progress write: unregistered project alias -> exit 1", async () => {
    const result = await runCli(["progress", "write", "--project", "nope", "--summary", "x"]);
    expect(result.exitCode).toBe(1);
  });

  it(
    "progress write regenerates progress.yaml/PROGRESS.md/the studio-wide progress.md in one call, and " +
      "`progress` (bare) / `progress --project` read them back correctly -- specifically exercises commander's " +
      "nested `progress write --project ...` parsing, where `progress`'s own `--project` option must not swallow " +
      "the value meant for `write`'s `--project`",
    async () => {
      const projectDir = buildFixtureRepo();
      await runCli(["project", "add", "--path", projectDir, "--alias", "demo", "--json"]);

      const writeResult = await runCli([
        "progress",
        "write",
        "--project",
        "demo",
        "--summary",
        "wiring up phase 7",
        "--skill",
        "skill:map-project",
        "--step",
        "scan",
        "--json",
      ]);
      expect(writeResult.exitCode).toBe(0);
      const payload = JSON.parse(writeResult.stdout);
      expect(payload.ok).toBe(true);
      expect(payload.alias).toBe("demo");
      expect(fs.existsSync(path.join(studioHome, "projects", "demo", "progress.yaml"))).toBe(true);
      expect(fs.existsSync(path.join(studioHome, "projects", "demo", "PROGRESS.md"))).toBe(true);
      expect(fs.existsSync(path.join(studioHome, "progress.md"))).toBe(true);

      // `progress` with no --project -> the studio-wide rollup, not a
      // sole-registered-project default.
      const rollup = await runCli(["progress"]);
      expect(rollup.exitCode).toBe(0);
      expect(rollup.stdout).toContain("demo");
      expect(rollup.stdout).toContain("wiring up phase 7");

      // `progress --project demo` (level 1 default) -> one-line summary.
      const level1 = await runCli(["progress", "--project", "demo"]);
      expect(level1.exitCode).toBe(0);
      expect(level1.stdout).toContain("wiring up phase 7");
      expect(level1.stdout).not.toContain("# Progress");

      // `progress --project demo --level 2` -> full PROGRESS.md.
      const level2 = await runCli(["progress", "--project", "demo", "--level", "2"]);
      expect(level2.exitCode).toBe(0);
      expect(level2.stdout).toContain("# Progress");
      expect(level2.stdout).toContain("wiring up phase 7");

      // `progress --project demo --level 3` -> raw progress.yaml.
      const level3 = await runCli(["progress", "--project", "demo", "--level", "3"]);
      expect(level3.exitCode).toBe(0);
      expect(level3.stdout).toContain("wiring up phase 7");
      expect(level3.stdout).toContain("current:");
    },
  );

  it("progress --project: unregistered alias -> exit 1", async () => {
    const result = await runCli(["progress", "--project", "nope"]);
    expect(result.exitCode).toBe(1);
  });

  describe("ir check / ir diff", () => {
    const FIXTURE_IR = path.resolve(
      __dirname, "..", "..", "core", "src", "ir", "__fixtures__", "valid.ir.yaml",
    );

    async function registerFixture(): Promise<string> {
      const repo = buildFixtureRepo();
      await runCli(["init", "--name", "IR Studio"]);
      await runCli(["project", "add", "--path", repo, "--alias", "fixture"]);
      return repo;
    }

    it("ir check --file: 고정 자료가 43개 검사를 전부 통과한다 (문서는 파일 옆에서 찾는다)", async () => {
      await registerFixture();
      const result = await runCli(["ir", "check", "--project", "fixture", "--file", FIXTURE_IR, "--json"]);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body.passed).toBe(true);
      expect(body.checks).toHaveLength(43);
      expect(body.skipped).toEqual([]);
    });

    it("ir check: 실패하면 exit 1 · 돌아갈 칸과 같이 무효가 된 칸을 지목한다", async () => {
      await registerFixture();
      const broken = path.join(studioHome, "broken.ir.yaml");
      // 1.0이 모델을 요구하는데 models[] 가 비었다 — 시험 DRC가 툴 개수로 잘못 검사하던 자리.
      fs.writeFileSync(broken, fs.readFileSync(FIXTURE_IR, "utf8").replace(/^models:\n(?:  .*\n)+/m, "models: []\n"));
      // 깨뜨린 파일은 studioHome 에 있으므로 문서 루트를 고정 자료 폴더로 되돌린다 —
      // 아니면 1.6까지 같이 깨져서 「1.2만 실패」라는 이 시험의 뜻이 흐려진다.
      const docs = path.dirname(FIXTURE_IR);
      const result = await runCli(["ir", "check", "--project", "fixture", "--file", broken, "--docs", docs, "--json"]);
      expect(result.exitCode).toBe(1);
      const body = JSON.parse(result.stdout);
      expect(body.failed).toContain("1.2/model-declared");
      expect(body.failedGates).toEqual(["1.2"]);
      // 권한이 만들 수 있는 노드를 제약한다 (명세 §7.3).
      expect(body.invalidated).toEqual(["1.5", "1.6"]);
    });

    it("ir check: overlay에 ir 절이 없으면 1단계 미착수라고 말한다 — 빈 결과로 통과시키지 않는다", async () => {
      await registerFixture();
      const result = await runCli(["ir", "check", "--project", "fixture"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("1단계를 아직 시작하지 않았다");
    });

    it("ir check: 모르는 schemaVersion은 필드 오류가 아니라 버전 한 줄로 거절한다", async () => {
      await registerFixture();
      const future = path.join(studioHome, "future.ir.yaml");
      fs.writeFileSync(future, fs.readFileSync(FIXTURE_IR, "utf8").replace("schemaVersion: 3", "schemaVersion: 9"));
      const result = await runCli(["ir", "check", "--project", "fixture", "--file", future]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("schemaVersion 9");
    });

    it("ir diff: 승인된 IR이 없으면 이 초안이 첫 채택이라고 말한다", async () => {
      await registerFixture();
      const proposed = path.join(studioHome, "projects", "fixture", "ir.proposed.yaml");
      fs.mkdirSync(path.dirname(proposed), { recursive: true });
      fs.copyFileSync(FIXTURE_IR, proposed);
      const result = await runCli(["ir", "diff", "--project", "fixture", "--json"]);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body.firstAdoption).toBe(true);
      expect(body.current).toBeNull();
    });

    it("ir adopt: 검사를 통과한 초안을 채택하면 overlay.ir 가 생긴다", async () => {
      await registerFixture();
      const proposed = path.join(studioHome, "projects", "fixture", "ir.proposed.yaml");
      fs.mkdirSync(path.dirname(proposed), { recursive: true });
      fs.copyFileSync(FIXTURE_IR, proposed);
      // 문서 경로가 고정 자료 폴더 기준이라, 그 폴더를 레포로 다시 등록한다.
      await runCli(["project", "add", "--path", path.dirname(FIXTURE_IR), "--alias", "fx"]);
      fs.mkdirSync(path.join(studioHome, "projects", "fx"), { recursive: true });
      fs.copyFileSync(FIXTURE_IR, path.join(studioHome, "projects", "fx", "ir.proposed.yaml"));

      const result = await runCli(["ir", "adopt", "--project", "fx", "--json"]);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body).toMatchObject({ ok: true, version: 1, previousVersion: null });
      expect(fs.readFileSync(path.join(studioHome, "projects", "fx", "overlay.yaml"), "utf8")).toContain("fixture-agent");
    });

    it("ir adopt: 검사가 막으면 exit 1 · --force 는 없다", async () => {
      await registerFixture();
      await runCli(["project", "add", "--path", path.dirname(FIXTURE_IR), "--alias", "fx"]);
      const dir = path.join(studioHome, "projects", "fx");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(
        path.join(dir, "ir.proposed.yaml"),
        fs.readFileSync(FIXTURE_IR, "utf8").replace(/^models:\n(?:  .*\n)+/m, "models: []\n"),
      );
      const result = await runCli(["ir", "adopt", "--project", "fx"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("1.2");
      // project add 가 빈 overlay.yaml 을 미리 만든다 — 봐야 할 것은 ir 절이 없다는 것이다.
      const overlay = fs.readFileSync(path.join(dir, "overlay.yaml"), "utf8");
      expect(overlay).not.toContain("fixture-agent");
      expect(overlay).not.toMatch(/^ir:/m);
    });

    it("ir adopt: 승인된 IR을 바꿀 때는 --yes 없이 멈춘다 — 되묻지 않는다", async () => {
      await registerFixture();
      await runCli(["project", "add", "--path", path.dirname(FIXTURE_IR), "--alias", "fx"]);
      const dir = path.join(studioHome, "projects", "fx");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(FIXTURE_IR, path.join(dir, "ir.proposed.yaml"));
      expect((await runCli(["ir", "adopt", "--project", "fx", "--json"])).exitCode).toBe(0);

      const second = await runCli(["ir", "adopt", "--project", "fx"]);
      expect(second.exitCode).toBe(1);
      expect(second.stderr).toContain("--yes");

      const confirmed = await runCli(["ir", "adopt", "--project", "fx", "--yes", "--json"]);
      expect(confirmed.exitCode).toBe(0);
      expect(JSON.parse(confirmed.stdout)).toMatchObject({ version: 2, previousVersion: 1 });
      // 삭제 대신 보관한다 (원칙 16).
      expect(fs.existsSync(path.join(dir, "versions", "1", "ir.yaml"))).toBe(true);
    });

    it("ir diff: 초안이 없으면 exit 1", async () => {
      await registerFixture();
      const result = await runCli(["ir", "diff", "--project", "fixture"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("ir.proposed.yaml");
    });

    it("ir generate: 세 파일을 쓰고, 두 번째는 사람 수정을 덮지 않는다", async () => {
      await runCli(["init", "--name", "IR Studio"]);
      await runCli(["project", "add", "--path", path.dirname(FIXTURE_IR), "--alias", "fx"]);
      const dir = path.join(studioHome, "projects", "fx");
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(FIXTURE_IR, path.join(dir, "ir.proposed.yaml"));
      expect((await runCli(["ir", "adopt", "--project", "fx", "--json"])).exitCode).toBe(0);

      const dest = fs.mkdtempSync(path.join(os.tmpdir(), "patchbay-cli-generate-"));
      const first = await runCli([
        "ir", "generate", "--project", "fx", "--out", dest, "--json",
      ]);
      expect(first.exitCode).toBe(0);
      const body = JSON.parse(first.stdout);
      expect(body.written.sort()).toEqual(["evals.test.ts", "graph.ts", "state.ts"]);
      expect(fs.existsSync(path.join(dest, "graph.ts"))).toBe(true);

      const graphPath = path.join(dest, "graph.ts");
      fs.writeFileSync(graphPath, fs.readFileSync(graphPath, "utf8") + "\n// kept\n");
      const second = await runCli([
        "ir", "generate", "--project", "fx", "--out", dest, "--json",
      ]);
      expect(second.exitCode).toBe(0);
      const again = JSON.parse(second.stdout);
      expect(again.written).toEqual([]);
      expect(again.skipped.map((row: { file: string }) => row.file).sort()).toEqual(
        ["evals.test.ts", "graph.ts", "state.ts"],
      );
      expect(fs.readFileSync(graphPath, "utf8")).toContain("// kept");
    });

    /**
     * 3·4단계 -- 그래프에 스캔에 없던 관계가 들어갔는지, 그리고 앵커에서 문서까지
     * 근거 경로가 붙는지. 실물 프로젝트는 구현이 끝난 뒤 수락 시험이므로
     * 고정 자료를 레포로 세워 쓴다 (사용자 결정 2026-09-28).
     */
    async function adoptedProject(alias: string): Promise<string> {
      const repo = buildFixtureRepo();
      const guides = path.dirname(FIXTURE_IR);
      fs.cpSync(path.join(guides, "guides"), path.join(repo, "guides"), { recursive: true });
      await runCli(["init", "--name", "Knowledge Studio"]);
      await runCli(["project", "add", "--path", repo, "--alias", alias]);
      await runCli(["scan", "--project", alias]);
      const dir = path.join(studioHome, "projects", alias);
      fs.mkdirSync(dir, { recursive: true });
      fs.copyFileSync(FIXTURE_IR, path.join(dir, "ir.proposed.yaml"));
      const adopted = await runCli(["ir", "adopt", "--project", alias, "--json"]);
      expect(adopted.exitCode).toBe(0);
      return repo;
    }

    it("knowledge audit: 채택 전에는 스캔 복제본뿐이라고 경고하고, 채택 뒤에는 그치지만 exit는 0이다", async () => {
      const repo = buildFixtureRepo();
      await runCli(["init", "--name", "Knowledge Studio"]);
      await runCli(["project", "add", "--path", repo, "--alias", "kg"]);
      await runCli(["scan", "--project", "kg"]);

      const before = await runCli(["knowledge", "audit", "--project", "kg", "--json"]);
      // 경고는 실패가 아니다 — 설계를 아직 채택하지 않은 것도 정당한 상태다.
      expect(before.exitCode).toBe(0);
      const beforeBody = JSON.parse(before.stdout);
      expect(beforeBody.designEdges).toBe(0);
      expect(beforeBody.warning).toContain("스캔 복제본뿐이다");
      expect(beforeBody.irVersion).toBeNull();

      await adoptedProject("kg2");
      const after = await runCli(["knowledge", "audit", "--project", "kg2", "--json"]);
      expect(after.exitCode).toBe(0);
      const afterBody = JSON.parse(after.stdout);
      expect(afterBody.designEdges).toBeGreaterThan(0);
      expect(afterBody.warning).toBeNull();
      expect(afterBody.counts).toMatchObject({ documents: 4, requirements: 7, evals: 6, agentNodes: 4 });
      // 3.2 — 모든 관계가 원본 파일과 재생성 명령을 말한다.
      for (const origin of Object.values(afterBody.origins) as Array<{ source: string; rebuild: string }>) {
        expect(origin.source).toMatch(/\.(json|yaml)/);
        expect(origin.rebuild.length).toBeGreaterThan(0);
      }
    });

    it("knowledge docs: 서로 다른 입력이 서로 다른 문서를 고르고, 전부 근거 경로를 달고 온다", async () => {
      await adoptedProject("kg3");
      for (const [input, expected] of [
        ["저장 버튼이 두 번 눌린다 — 버그다", "guides/bug.md"],
        ["이런 기능을 요청합니다", "guides/request.md"],
        ["이게 왜 이렇게 되는지 질문이 있습니다", "guides/question.md"],
      ]) {
        const result = await runCli([
          "knowledge", "docs", "--project", "kg3", "--anchor", "pick", "--input", input!, "--json",
        ]);
        expect(result.exitCode).toBe(0);
        const body = JSON.parse(result.stdout);
        expect(body.hits[0].path).toBe(expected);
        expect(body.hits[0].matched).toBeGreaterThan(0);
        for (const hit of body.hits) {
          expect(hit.via.startsWith("pick")).toBe(true);
          expect(hit.via).toContain(hit.documentId);
        }
      }
    });

    it("knowledge docs: 앵커를 못 찾으면 exit 1 · 고르지 않고 후보를 말한다", async () => {
      await adoptedProject("kg4");
      const missing = await runCli(["knowledge", "docs", "--project", "kg4", "--anchor", "없는앵커", "--json"]);
      expect(missing.exitCode).toBe(1);
      expect(JSON.parse(missing.stderr).error).toContain("맞는 항목이 없다");

      const ambiguous = await runCli(["knowledge", "docs", "--project", "kg4", "--anchor", "ir:document", "--json"]);
      expect(ambiguous.exitCode).toBe(1);
      const body = JSON.parse(ambiguous.stderr);
      expect(body.error).toContain("좁혀");
      expect(body.candidates.length).toBeGreaterThan(1);
    });

    /**
     * 실측으로 찾은 것: 스캔은 `guides/*.md` 를 잭으로 잡지 않는다 (신호·소스 파일만).
     * 그래서 실물에서 `guides/bug.md` 를 가진 행은 그것을 `source:` 주소로 들고 있는
     * 문서 의존 한 줄뿐이고, 4.1이 항목 주소까지 봐야 사람이 손에 쥔 경로가 앵커가 된다.
     */
    it("knowledge docs: 스캔이 잭으로 잡지 않은 안내 파일도 그 경로로 앵커가 된다", async () => {
      await adoptedProject("kg6");
      const result = await runCli([
        "knowledge", "docs", "--project", "kg6", "--anchor", "guides/bug.md", "--hops", "1", "--json",
      ]);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body.anchorPath).toBe("ir:document/D1");
      expect(body.hits.map((hit: { documentId: string }) => hit.documentId)).toContain("D1");
    });

    it("knowledge docs: --anchor 없이는 멈춘다", async () => {
      await adoptedProject("kg5");
      const result = await runCli(["knowledge", "docs", "--project", "kg5"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("--anchor");
    });

    const RUNS_FIXTURES = path.resolve(
      __dirname, "..", "..", "core", "src", "runs", "__fixtures__",
    );

    /** 설계를 채택하고 성공·거절·타임아웃 세 기록을 수집한 상태. */
    async function collectedProject(alias: string): Promise<string> {
      const repo = await adoptedProject(alias);
      for (const name of ["success", "refused", "timeout"]) {
        const result = await runCli([
          "runs", "collect", "--project", alias, "--file", path.join(RUNS_FIXTURES, `${name}.json`), "--json",
        ]);
        expect(result.exitCode, name).toBe(0);
      }
      return repo;
    }

    it("runs collect: 성공·거절·타임아웃이 서로 다른 상태로 수집된다", async () => {
      await collectedProject("m6a");
      const result = await runCli(["runs", "collect", "--project", "m6a", "--file", path.join(RUNS_FIXTURES, "success.json"), "--json"]);
      const body = JSON.parse(result.stdout);
      expect(body.total).toBe(3);
      expect(body.byStatus).toEqual({ success: 1, refused: 1, timeout: 1 });
      // 한 실행 한 파일 (§5.3).
      const dir = path.join(studioHome, "projects", "m6a", "test-runs");
      expect(fs.readdirSync(dir).sort()).toEqual([
        "run-fixture-0001.json", "run-fixture-0002.json", "run-fixture-0003.json",
      ]);
    });

    it("runs collect: §5.2를 어긴 기록은 거절하고 어느 칸인지 말한다", async () => {
      await adoptedProject("m6b");
      const broken = path.join(studioHome, "broken-run.json");
      const raw = JSON.parse(fs.readFileSync(path.join(RUNS_FIXTURES, "success.json"), "utf8"));
      delete raw.toolCalls;
      fs.writeFileSync(broken, JSON.stringify(raw), "utf8");
      const result = await runCli(["runs", "collect", "--project", "m6b", "--file", broken, "--json"]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stderr).refused.join(" ")).toContain("toolCalls");
    });

    it("runs compare: 설계에 없는 권한으로 돈 툴을 잡는다", async () => {
      await collectedProject("m6c");
      const rogue = JSON.parse(fs.readFileSync(path.join(RUNS_FIXTURES, "success.json"), "utf8"));
      rogue.runId = "run-rogue";
      rogue.toolCalls = [{ nodeId: "pick", tool: "write-draft", caps: ["cap:draft", "cap:pr"], status: "success" }];
      const file = path.join(studioHome, "rogue.json");
      fs.writeFileSync(file, JSON.stringify(rogue), "utf8");
      await runCli(["runs", "collect", "--project", "m6c", "--file", file, "--json"]);

      const result = await runCli(["runs", "compare", "--project", "m6c", "--json"]);
      // 어긋남이 있으면 exit 1 — CI가 관문으로 쓸 수 있다.
      expect(result.exitCode).toBe(1);
      const body = JSON.parse(result.stdout);
      expect(body.compare.byStatus).toMatchObject({ success: 2, refused: 1, timeout: 1 });
      const kinds = body.compare.findings.map((finding: { kind: string }) => finding.kind);
      expect(kinds).toContain("cap-not-declared");
    });

    /** 통과 조건 — 실패 사례는 사람 승인 전 평가 원본을 바꾸지 않는다. */
    it("runs draft-evals --write: 초안에만 쓰고 승인된 설계는 그대로다", async () => {
      await collectedProject("m6d");
      const overlay = path.join(studioHome, "projects", "m6d", "overlay.yaml");
      const before = fs.readFileSync(overlay, "utf8");

      const result = await runCli(["runs", "draft-evals", "--project", "m6d", "--write", "--json"]);
      expect(result.exitCode).toBe(0);
      const body = JSON.parse(result.stdout);
      expect(body.draftEvals.map((draft: { id: string }) => draft.id)).toEqual(["E7", "E8"]);
      expect(body.requirementLinksToFill.every((row: { requirement: null }) => row.requirement === null)).toBe(true);

      expect(fs.readFileSync(overlay, "utf8")).toBe(before);
      const draft = fs.readFileSync(path.join(studioHome, "projects", "m6d", "ir.proposed.yaml"), "utf8");
      expect(draft).toContain("E7");
      // 요구사항 칸은 파일에도 주석으로만 남는다 — requirement: null 은 유효한 IR이 아니다.
      expect(draft).toContain("채울 추적 표 행");

      const diff = await runCli(["ir", "diff", "--project", "m6d", "--json"]);
      const sections = JSON.parse(diff.stdout).sections as Array<{ section: string; added: string[] }>;
      expect(sections.find((row) => row.section === "evals")?.added).toEqual(["E7", "E8"]);
    });

    it("evals record: 승인된 설계와 다른 버전의 결과는 붙이지 않는다", async () => {
      await adoptedProject("m6e");
      const file = path.join(studioHome, "wrong-version.json");
      fs.writeFileSync(
        file,
        JSON.stringify({
          irVersion: 9,
          ranAt: "2026-09-30T00:00:00.000Z",
          results: [{ evalId: "E1", kind: "deterministic", status: "pass" }],
        }),
        "utf8",
      );
      const result = await runCli(["evals", "record", "--project", "m6e", "--file", file, "--json"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("v9");
    });

    /** 통과 조건 — 같은 평가 묶음으로 두 버전을 비교하고, 모델을 바꾸면 점수와 비용을 함께 본다. */
    it("version compare: 같은 묶음이면 나란히, 달라지면 거절한다", async () => {
      await collectedProject("m6f");
      const dir = path.join(studioHome, "projects", "m6f");
      const evalsFile = path.join(studioHome, "evals-in.json");
      const writeEvals = (irVersion: number, ids: string[], allPass: boolean) =>
        fs.writeFileSync(
          evalsFile,
          JSON.stringify({
            irVersion,
            ranAt: "2026-09-30T00:00:00.000Z",
            how: "고정 응답 어댑터",
            results: ids.map((evalId, index) => ({
              evalId,
              kind: "deterministic",
              status: allPass || index > 0 ? "pass" : "fail",
            })),
          }),
          "utf8",
        );

      const six = ["E1", "E2", "E3", "E4", "E5", "E6"];
      writeEvals(1, six, false);
      expect((await runCli(["evals", "record", "--project", "m6f", "--file", evalsFile, "--json"])).exitCode).toBe(0);

      // 모델만 바꾼 초안으로 v2를 채택한다 — 평가 묶음은 그대로다.
      const swapped = fs
        .readFileSync(FIXTURE_IR, "utf8")
        .replace(/claude-opus-5/g, "claude-haiku-4-5-20251001");
      fs.writeFileSync(path.join(dir, "ir.proposed.yaml"), swapped, "utf8");
      const adopted = await runCli(["ir", "adopt", "--project", "m6f", "--yes", "--json"]);
      expect(adopted.exitCode).toBe(0);
      // V.1 — 나가는 버전의 평가 결과가 함께 보관된다.
      expect(fs.readdirSync(path.join(dir, "versions", "1")).sort()).toEqual([
        "adopted.json", "evals.json", "ir.approved-provenance.json", "ir.yaml",
      ]);

      writeEvals(2, six, true);
      expect((await runCli(["evals", "record", "--project", "m6f", "--file", evalsFile, "--json"])).exitCode).toBe(0);

      const same = await runCli(["version", "compare", "--project", "m6f", "--json"]);
      expect(same.exitCode).toBe(0);
      const body = JSON.parse(same.stdout);
      expect(body.comparable).toBe(true);
      expect(body.result.modelChanged).toBe(true);
      expect(body.result.before.score.passed).toBe(5);
      expect(body.result.after.score.passed).toBe(6);
      // V.4 — 비용이 점수와 함께 온다. 기록은 v1의 것이다.
      expect(body.result.before.usage.runs).toBe(3);
      expect(body.result.after.usage.runs).toBe(0);

      // 묶음을 바꾸면 나란히 놓지 않는다 (명세 §6.2).
      writeEvals(2, [...six, "E7"], true);
      await runCli(["evals", "record", "--project", "m6f", "--file", evalsFile, "--json"]);
      const moved = await runCli(["version", "compare", "--project", "m6f", "--json"]);
      expect(moved.exitCode).toBe(1);
      expect(JSON.parse(moved.stdout).result.reason).toContain("평가 묶음이 다르다");
    });

    it("version compare: 비교할 버전이 하나뿐이면 멈추고 무엇을 하라고 말한다", async () => {
      await adoptedProject("m6g");
      const result = await runCli(["version", "compare", "--project", "m6g"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("ir adopt");
    });

    it("ir generate: overlay.ir 가 없으면 1단계를 통과하라고 말한다", async () => {
      await registerFixture();
      const result = await runCli(["ir", "generate", "--project", "fixture"]);
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain("1단계를 통과한 뒤에 생성한다");
    });
  });
});
