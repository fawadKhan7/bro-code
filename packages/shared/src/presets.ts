/** Role presets — ported from Conductor (conductor/shared/src/presets.ts).
 *  Demoted by design: presets seed role text and ownerHint biases; the plan decides the split.
 */

export type PresetId =
  | "frontend-backend"
  | "builder-reviewer"
  | "architect-implementer"
  | "feature-tests"
  | "service-ab"
  | "custom";

export interface RolePreset {
  id: PresetId;
  label: string;
  roleA: string;
  roleB: string;
  focusA: string;
  focusB: string;
}

export const PRESETS: Record<Exclude<PresetId, "custom">, RolePreset> = {
  "frontend-backend": {
    id: "frontend-backend",
    label: "Frontend / Backend",
    roleA: "Frontend",
    roleB: "Backend",
    focusA:
      "UI, client flows, forms, routing, and browser token storage. Use get_contracts before integrating APIs. Post UI contracts and component paths via post_update with refs.",
    focusB:
      "REST/GraphQL routes, auth, persistence, and server validation. Publish endpoints and schemas early with post_contract so your peer can integrate.",
  },
  "builder-reviewer": {
    id: "builder-reviewer",
    label: "Builder / Reviewer",
    roleA: "Builder",
    roleB: "Reviewer",
    focusA: "Implement features end-to-end in your workspace. Post checkpoints when a slice is ready for review.",
    focusB:
      "Review Builder's updates via get_contracts. Focus on correctness, security, and tests. Post feedback-style updates; avoid large rewrites without checkpoint.",
  },
  "architect-implementer": {
    id: "architect-implementer",
    label: "Architect / Implementer",
    roleA: "Architect",
    roleB: "Implementer",
    focusA: "Define structure, interfaces, and file layout. Post contracts and refs before Implementer depends on them.",
    focusB: "Implement according to Architect's contracts. Ask via post_update if contracts are missing.",
  },
  "feature-tests": {
    id: "feature-tests",
    label: "Feature / Tests",
    roleA: "Feature Builder",
    roleB: "Test Writer",
    focusA: "Ship working feature code. Post refs to modules Test Writer should cover.",
    focusB: "Write tests against Feature Builder's contracts. Use get_contracts with since_version to avoid stale reads.",
  },
  "service-ab": {
    id: "service-ab",
    label: "Service A / Service B",
    roleA: "Service A",
    roleB: "Service B",
    focusA: "Own Service A boundaries. Post API/event contracts for Service B.",
    focusB: "Own Service B boundaries. Integrate only via get_contracts deltas.",
  },
};

export function isPresetId(value: string): value is PresetId {
  return value === "custom" || value in PRESETS;
}

export interface BriefOverrides {
  briefA?: string;
  briefB?: string;
  customRoleA?: string;
  customRoleB?: string;
}

/** Static template expansion — zero LLM, zero API keys.
 *  The "bias, not boundary" wording is deliberate: the plan decides actual ownership.
 */
export function buildBriefs(
  goal: string,
  preset: PresetId,
  overrides?: BriefOverrides
): { briefA: string; briefB: string } {
  if (overrides?.briefA && overrides?.briefB) {
    return { briefA: overrides.briefA, briefB: overrides.briefB };
  }

  const bias =
    "This is a starting bias, not a boundary — if the plan surfaces work outside it that lives in your workspace, claim it.";

  if (preset === "custom") {
    const roleA = overrides?.customRoleA ?? "Agent A";
    const roleB = overrides?.customRoleB ?? "Agent B";
    return {
      briefA: `Role: ${roleA}\n\nShared goal: ${goal}\n\n${bias}`,
      briefB: `Role: ${roleB}\n\nShared goal: ${goal}\n\n${bias}`,
    };
  }

  const p = PRESETS[preset];
  return {
    briefA: `Role: ${p.roleA}\n\nShared goal: ${goal}\n\nPrimary responsibility: ${p.focusA}\n${bias}`,
    briefB: `Role: ${p.roleB}\n\nShared goal: ${goal}\n\nPrimary responsibility: ${p.focusB}\n${bias}`,
  };
}
