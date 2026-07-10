import type { ConductorSession } from "./types";
/** Condensed context after checkpoint resume — no LLM. */
export declare function buildResumeBrief(session: ConductorSession, feedback: string | null): string;
