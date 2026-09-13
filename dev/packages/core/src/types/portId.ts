import { z } from "zod";

/**
 * PortId addressing scheme (Patchbay ontology v0, spec section 7.1):
 *
 *   PortId     = kind ":" ref
 *   kind       = "source" | "skill" | "artifact" | "agent" | "signal"
 *   ref        = fileRef | slug
 *   fileRef    = POSIX relative path from project root. No leading "./". No backslashes.
 *   slug       = [a-z0-9][a-z0-9-]*     (a studio Skill Bay name)
 *
 * Ambiguity rule (skill: kind only): a bare name with no slash and no
 * extension (e.g. "map-project") is ALWAYS a studio Bay slug. A
 * project-local skill reference MUST end in "SKILL.md" — that is how a
 * fileRef is told apart from a slug for the "skill:" kind specifically.
 */

export const PORT_KINDS = ["source", "skill", "artifact", "agent", "signal"] as const;
export type PortKind = (typeof PORT_KINDS)[number];

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isSlug(ref: string): boolean {
  return SLUG_PATTERN.test(ref);
}

/** POSIX relative-path safety: no absolute paths, no "./" prefix, no ".." segments, no backslashes. */
function isValidFileRef(ref: string): boolean {
  if (ref.length === 0) return false;
  if (ref.includes("\\")) return false;
  if (ref.startsWith("/")) return false;
  if (ref.startsWith("./")) return false;
  if (/^[A-Za-z]:/.test(ref)) return false; // reject Windows-style absolute paths too
  const segments = ref.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

export type PortIdValidation = { valid: true } | { valid: false; reason: string };

/** Pure validation of a raw PortId string against the grammar + ambiguity rule above. */
export function validatePortId(raw: string): PortIdValidation {
  if (raw.length === 0) {
    return { valid: false, reason: "PortId must not be empty" };
  }
  if (/\s/.test(raw)) {
    return { valid: false, reason: "PortId must not contain whitespace" };
  }

  const separatorIndex = raw.indexOf(":");
  if (separatorIndex <= 0) {
    return { valid: false, reason: 'PortId must have a non-empty kind followed by ":"' };
  }

  const kind = raw.slice(0, separatorIndex);
  const ref = raw.slice(separatorIndex + 1);

  if (!(PORT_KINDS as readonly string[]).includes(kind)) {
    return { valid: false, reason: `Unknown PortId kind: "${kind}"` };
  }
  if (ref.length === 0) {
    return { valid: false, reason: "PortId ref must not be empty" };
  }

  if (kind === "skill") {
    // A ref with a slash or a dot reads as path-like, so it must be a
    // project-local fileRef — and those must end in SKILL.md. Anything
    // else (no slash, no dot) is always a Bay slug.
    const looksLikeFileRef = ref.includes("/") || ref.includes(".");
    if (looksLikeFileRef) {
      if (!ref.endsWith("SKILL.md")) {
        return {
          valid: false,
          reason: 'skill: fileRef must end in "SKILL.md" to disambiguate it from a Bay slug',
        };
      }
      if (!isValidFileRef(ref)) {
        return { valid: false, reason: `Invalid file path: "${ref}"` };
      }
      return { valid: true };
    }
    if (!isSlug(ref)) {
      return { valid: false, reason: `Invalid Bay slug: "${ref}"` };
    }
    return { valid: true };
  }

  if (isValidFileRef(ref) || isSlug(ref)) {
    return { valid: true };
  }
  return { valid: false, reason: `Invalid PortId ref: "${ref}"` };
}

export const portIdSchema = z
  .string()
  .superRefine((raw, ctx) => {
    const result = validatePortId(raw);
    if (!result.valid) {
      ctx.addIssue({ code: "custom", message: result.reason });
    }
  })
  .brand<"PortId">();

export type PortId = z.infer<typeof portIdSchema>;

/** Standalone parse helper, equivalent to `portIdSchema.safeParse(raw)`. */
export function parsePortId(raw: string) {
  return portIdSchema.safeParse(raw);
}

/** A PortId schema constrained to a single kind, e.g. `portIdOfKind("skill")`. */
export function portIdOfKind(kind: PortKind) {
  return portIdSchema.refine((value) => value.startsWith(`${kind}:`), {
    message: `PortId must have kind "${kind}"`,
  });
}
