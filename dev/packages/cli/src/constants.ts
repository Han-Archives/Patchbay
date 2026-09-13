/**
 * Below this clarity score, `patchbay project add` refuses to register the
 * project (exit 2) unless `--force-add` is passed. This is a CLI-layer
 * policy (the "triage gate"), not part of the pure `computeClarityScore`
 * formula in `@patchbay/core` -- lives here so the literal `40` has exactly
 * one owner.
 */
export const CLARITY_GATE_THRESHOLD = 40;
