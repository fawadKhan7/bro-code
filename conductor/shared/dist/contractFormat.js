"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatContractLines = formatContractLines;
function formatContractLines(updates) {
    if (updates.length === 0)
        return "(no new updates)";
    return updates
        .map((u) => {
        const diffPart = u.diff?.added?.length
            ? ` (+${u.diff.added.join(", ")})`
            : "";
        const refsPart = u.refs?.length ? `\n     refs: ${u.refs.join(", ")}` : "";
        return `[v${u.version}] ${u.from} → ${u.summary}${diffPart}${refsPart}`;
    })
        .join("\n");
}
//# sourceMappingURL=contractFormat.js.map