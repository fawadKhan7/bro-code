export declare function hashContent(content: string): string;
/** Slug: lowercase letters, digits, hyphens; max 64 chars. */
export declare function sanitizeServiceSlug(raw: string): string;
/** Parse `service: foo-bar` from first lines of content. */
export declare function parseServiceFromContent(content: string): string | undefined;
export declare function resolveServiceSlug(content: string, explicit?: string): string;
export interface ContractDiskEntry {
    agentId: string;
    timestamp: string;
    contentHash: string;
    title?: string;
    revision: number;
    content: string;
}
/** Prepends a new revision block; older content kept below a horizontal rule. */
export declare function writeContractRevisionToDisk(workspaceRoot: string, slug: string, entry: ContractDiskEntry): string;
//# sourceMappingURL=contractDisk.d.ts.map