import { describe, expect, it } from "vitest";
import { labelFromNeo4jLabels } from "@patchbay/core";
import {
  DEFAULT_NEO4J_PASSWORD,
  DEFAULT_NEO4J_URI,
  DEFAULT_NEO4J_USER,
  KNOWLEDGE_HIT_LIMIT,
  resolveNeo4jPassword,
  resolveNeo4jUri,
  resolveNeo4jUser,
} from "./neo4jContract.js";

describe("Neo4j freeze values", () => {
  it("matches spec 4.2 defaults", () => {
    expect(DEFAULT_NEO4J_URI).toBe("bolt://127.0.0.1:7687");
    expect(DEFAULT_NEO4J_USER).toBe("neo4j");
    expect(DEFAULT_NEO4J_PASSWORD).toBe("patchbay");
    expect(KNOWLEDGE_HIT_LIMIT).toBe(40);
    expect(resolveNeo4jUri()).toBe(DEFAULT_NEO4J_URI);
    expect(resolveNeo4jUser("  ")).toBe(DEFAULT_NEO4J_USER);
    expect(resolveNeo4jPassword("")).toBe(DEFAULT_NEO4J_PASSWORD);
    expect(resolveNeo4jPassword("secret")).toBe("secret");
  });

  it("picks a knowledge label from Neo4j label lists", () => {
    expect(labelFromNeo4jLabels(["Knowledge", "Skill"])).toBe("Skill");
    expect(labelFromNeo4jLabels(["Knowledge", "Document"])).toBe("Document");
    expect(labelFromNeo4jLabels(["Knowledge"])).toBe("File");
  });
});
