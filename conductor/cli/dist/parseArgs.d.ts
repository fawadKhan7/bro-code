import type { PresetId } from "@conductor/shared";
export interface StartArgs {
    goal: string | null;
    preset?: PresetId;
    briefA?: string;
    briefB?: string;
}
export declare function parseStartArgs(argv: string[]): StartArgs;
