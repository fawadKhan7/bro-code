import type { PresetId } from "./types";
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
export declare function buildBriefs(goal: string, preset: PresetId, overrides?: {
    briefA?: string;
    briefB?: string;
    customRoleA?: string;
    customRoleB?: string;
}): {
    briefA: string;
    briefB: string;
};
