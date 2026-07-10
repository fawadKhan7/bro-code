/** Role presets — ported from Conductor (conductor/shared/src/presets.ts).
 *  Demoted by design: presets seed role text and ownerHint biases; the plan decides the split.
 */
export type PresetId = "frontend-backend" | "builder-reviewer" | "architect-implementer" | "feature-tests" | "service-ab" | "custom";
export interface RolePreset {
    id: PresetId;
    label: string;
    roleA: string;
    roleB: string;
    focusA: string;
    focusB: string;
}
export declare const PRESETS: Record<Exclude<PresetId, "custom">, RolePreset>;
export declare function isPresetId(value: string): value is PresetId;
export interface BriefOverrides {
    briefA?: string;
    briefB?: string;
    customRoleA?: string;
    customRoleB?: string;
}
/** Static template expansion — zero LLM, zero API keys.
 *  The "bias, not boundary" wording is deliberate: the plan decides actual ownership.
 */
export declare function buildBriefs(goal: string, preset: PresetId, overrides?: BriefOverrides): {
    briefA: string;
    briefB: string;
};
//# sourceMappingURL=presets.d.ts.map