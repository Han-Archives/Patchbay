import { z } from "zod";
import { patchSchema, wireSchema } from "./project.js";
import { decisionSchema } from "./domain.js";

/**
 * `overlay.yaml` shape — this file is human-owned. A scan process must
 * never overwrite it (a runtime/process rule enforced elsewhere, not by
 * this schema — hence no field here implies anything is "generated").
 */

export const overlaySchema = z.object({
  patches: z.array(patchSchema).default([]),
  wires: z.array(wireSchema).default([]),
  decisions: z.array(decisionSchema).default([]),
  accepted_guides: z.array(z.string()).default([]), // ids/slugs of guides the human has accepted
});
export type Overlay = z.infer<typeof overlaySchema>;
