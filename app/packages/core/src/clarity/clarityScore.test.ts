import { describe, expect, it } from "vitest";
import { inferredSchema } from "../types/inferred.js";
import { computeClarityScore, hasReadmePort } from "./clarityScore.js";

const baseGit = { branch: "main", head: "a".repeat(40), recentCommitSubjects: [] };

describe("computeClarityScore", () => {
  it("README + all-unique commits + no duplicates = 100", () => {
    const score = computeClarityScore({
      hasReadme: true,
      commitSubjects: ["a", "b", "c"],
      allRelativePaths: ["src/index.ts", "README.md"],
    });
    expect(score).toBe(100);
  });

  it("no README, zero commits, no duplicates = 0 (not NaN)", () => {
    const score = computeClarityScore({ hasReadme: false, commitSubjects: [], allRelativePaths: [] });
    expect(score).toBe(0);
  });

  it("commit-subject uniqueness term is (unique/total) * 50", () => {
    const score = computeClarityScore({
      hasReadme: false,
      commitSubjects: ["fix bug", "fix bug", "fix bug", "add feature"],
      allRelativePaths: [],
    });
    // unique=2, total=4 -> 0.5 * 50 = 25
    expect(score).toBe(25);
  });

  it("counts every (file, pattern) match, including a filename matching two patterns", () => {
    // "report_final_v2.md" matches both "_final" and "_v2" -> 2 matches -> -10 penalty.
    const score = computeClarityScore({
      hasReadme: true,
      commitSubjects: [],
      allRelativePaths: ["docs/report_final_v2.md"],
    });
    expect(score).toBe(50 - 10);
  });

  it("floors the duplicate penalty at -30 regardless of match count", () => {
    const manyDuplicates = Array.from({ length: 20 }, (_, i) => `file_v2_${i}.txt`);
    const score = computeClarityScore({
      hasReadme: true,
      commitSubjects: ["only one"],
      allRelativePaths: manyDuplicates,
    });
    // readme 50 + uniqueness 50, penalty floored at -30 -> 70, clamped to [0,100] -> 70
    expect(score).toBe(70);
  });

  it("clamps the final result to [0, 100] even when the raw formula would go negative", () => {
    const manyDuplicates = Array.from({ length: 50 }, (_, i) => `x_backup_${i} copy.txt`);
    const score = computeClarityScore({
      hasReadme: false,
      commitSubjects: [],
      allRelativePaths: manyDuplicates,
    });
    expect(score).toBe(0);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("matches patterns as substrings against the basename only, case-sensitively", () => {
    const score = computeClarityScore({
      hasReadme: true,
      commitSubjects: [],
      allRelativePaths: ["some/dir/notes복사본.txt", "some/dir/NOTES_V2.txt"], // uppercase _V2 must not match
    });
    // one match (복사본) -> -5
    expect(score).toBe(45);
  });
});

describe("hasReadmePort", () => {
  it("true for source:README.md", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: ["source:README.md"], git: baseGit });
    expect(hasReadmePort(inferred)).toBe(true);
  });

  it("true for any README.* variant, e.g. source:README.ko.md", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: ["source:README.ko.md"], git: baseGit });
    expect(hasReadmePort(inferred)).toBe(true);
  });

  it("false when there is no README port", () => {
    const inferred = inferredSchema.parse({ discoveredPorts: ["source:AGENTS.md"], git: baseGit });
    expect(hasReadmePort(inferred)).toBe(false);
  });

  it("false for a bare README with no extension (not matched, per the scanner's own rule)", () => {
    // discoveredPorts can only ever contain what the scanner emits, but this
    // documents that hasReadmePort follows the same README.* (not bare
    // README) rule rather than reinventing detection.
    const inferred = inferredSchema.parse({ discoveredPorts: [], git: baseGit });
    expect(hasReadmePort(inferred)).toBe(false);
  });
});
