#!/usr/bin/env node
/**
 * Minimal CI helper: fail if contracts/*.md are missing when CONTRACTS_REQUIRED=1,
 * or warn when the directory is empty. Customize your repo's OpenAPI/schema checks here.
 *
 * Usage (from repo root):
 *   node scripts/check-contracts.mjs
 */
import * as fs from "fs";
import * as path from "path";

const root = process.cwd();
const dir = path.join(root, "contracts");
const required = process.env.CONTRACTS_REQUIRED === "1";

if (!fs.existsSync(dir)) {
  if (required) {
    console.error("check-contracts: contracts/ missing but CONTRACTS_REQUIRED=1");
    process.exit(1);
  }
  console.log("check-contracts: no contracts/ directory — skipping.");
  process.exit(0);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
if (files.length === 0 && required) {
  console.error("check-contracts: contracts/*.md required but directory is empty.");
  process.exit(1);
}

console.log(`check-contracts: found ${files.length} markdown file(s) in contracts/.`);
for (const f of files) {
  const p = path.join(dir, f);
  const st = fs.statSync(p);
  if (st.size === 0) {
    console.error(`check-contracts: empty file ${f}`);
    process.exit(1);
  }
}
process.exit(0);
