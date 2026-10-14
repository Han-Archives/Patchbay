import { createHash, timingSafeEqual } from "node:crypto";

export interface FlowAccess { token?: string; readToken?: string }
export type FlowAccessRole = "read" | "write";
export const FLOW_SESSION_COOKIE = "patchbay_session";
export function sessionToken(secret: string): string { return createHash("sha256").update(`patchbay-session:${secret}`).digest("hex"); }
function equal(a: string, b: string) { return timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest()); }
export function accessRole(access: FlowAccess, bearer?: string, cookie?: string): FlowAccessRole | null {
  if (!access.token && !access.readToken) return "write";
  if (access.token && ((bearer && equal(bearer, access.token)) || (cookie && equal(cookie, sessionToken(access.token))))) return "write";
  if (access.readToken && ((bearer && equal(bearer, access.readToken)) || (cookie && equal(cookie, sessionToken(access.readToken))))) return "read";
  return null;
}
