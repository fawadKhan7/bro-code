"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PRESETS = void 0;
exports.isPresetId = isPresetId;
exports.buildBriefs = buildBriefs;
exports.PRESETS = {
    "frontend-backend": {
        id: "frontend-backend",
        label: "Frontend / Backend",
        roleA: "Frontend",
        roleB: "Backend",
        focusA: "UI, client flows, forms, routing, and browser token storage. Use get_contract before integrating APIs. Post UI contracts and component paths via post_update with refs.",
        focusB: "REST/GraphQL routes, auth, persistence, and server validation. Publish endpoints and schemas early with post_update + refs so Agent A can integrate.",
    },
    "builder-reviewer": {
        id: "builder-reviewer",
        label: "Builder / Reviewer",
        roleA: "Builder",
        roleB: "Reviewer",
        focusA: "Implement features end-to-end in your workspace. Post checkpoints when a slice is ready for review.",
        focusB: "Review Builder's updates via get_contract. Focus on correctness, security, and tests. Post feedback-style updates; avoid large rewrites without checkpoint.",
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
        focusB: "Write tests against Feature Builder's contracts. Use get_contract with sinceVersion to avoid stale reads.",
    },
    "service-ab": {
        id: "service-ab",
        label: "Service A / Service B",
        roleA: "Service A",
        roleB: "Service B",
        focusA: "Own Service A boundaries. Post API/event contracts for Service B.",
        focusB: "Own Service B boundaries. Integrate only via get_contract deltas.",
    },
};
function isPresetId(value) {
    return (value === "custom" ||
        value === "frontend-backend" ||
        value === "builder-reviewer" ||
        value === "architect-implementer" ||
        value === "feature-tests" ||
        value === "service-ab");
}
function buildBriefs(goal, preset, overrides) {
    if (overrides?.briefA && overrides?.briefB) {
        return { briefA: overrides.briefA, briefB: overrides.briefB };
    }
    if (preset === "custom") {
        const roleA = overrides?.customRoleA ?? "Agent A";
        const roleB = overrides?.customRoleB ?? "Agent B";
        return {
            briefA: `Role: ${roleA}\n\nShared goal: ${goal}\n\nWork in this workspace only. Coordinate via Conductor MCP tools.`,
            briefB: `Role: ${roleB}\n\nShared goal: ${goal}\n\nWork in this workspace only. Coordinate via Conductor MCP tools.`,
        };
    }
    const p = exports.PRESETS[preset];
    return {
        briefA: `Role: ${p.roleA}\n\nShared goal: ${goal}\n\nFocus: ${p.focusA}`,
        briefB: `Role: ${p.roleB}\n\nShared goal: ${goal}\n\nFocus: ${p.focusB}`,
    };
}
//# sourceMappingURL=presets.js.map