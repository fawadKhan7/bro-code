# Cursor adapter — spike findings

Time-boxed probe of `cursor-agent` against the phase-1 hub, required by
docs/05-implementation-plan/phase-03-cursor-adapters.md step 1. Re-run if cursor-agent changes.

## Environment probed

- `cursor-agent` version **2026.07.01-41b2de7** (macOS).

## Findings

1. **Streamable HTTP works — no legacy SSE needed.** With a project `.cursor/mcp.json` of
   `{"mcpServers":{"duo":{"url":"http://127.0.0.1:PORT/mcp"}}}`, `cursor-agent mcp list-tools duo`
   returned all 16 duo tools with correct argument names. So the adapter configures the same
   `/mcp` URL as Claude Code; the legacy `/sse` fallback is unused (kept in the hub only as a
   safety net for future versions).

2. **The approval quirk (the "MCP not attaching in print mode" reports).** A freshly-written
   server first shows `duo: not loaded (needs approval)` and `mcp list-tools` fails with
   `MCP server "duo" has not been approved`. Two independent fixes, applied together
   (belt-and-suspenders):
   - `configure()` runs `cursor-agent mcp enable <name>` in the workspace → `✓ Enabled and
     approved`. After that, `mcp list` shows `duo: ready`.
   - `launch()` passes `--approve-mcps` (auto-approve all MCP servers for that run).

3. **Launch flags** (headless, non-interactive, self-driving):
   `cursor-agent -p "<kickoff>" --output-format stream-json --force --approve-mcps --trust`
   - `-p` print/non-interactive · `--output-format stream-json` structured output
   - `--force` allow tool/command execution · `--approve-mcps` auto-approve MCP servers
   - `--trust` trust the workspace headlessly (only valid with `-p`)

4. **Held vs polling for approval.** Not exercised with a real model run (costs tokens). Given
   the community reports of held-call timeouts under cursor-agent print mode, the cursor-cli
   adapter defaults its kickoff to the **polling** variant (`get_plan_status` + backoff), which
   the hub has supported since phase 1. Claude Code stays on held calls. Revisit if a real run
   shows held calls are tolerated.

5. **Doctor probe.** `cursor-agent mcp list` is a cheap, model-free attachment check — doctor
   parses it to report `duo: ready` vs `needs approval` vs `Connection failed`.

## Known-bad versions

None recorded yet. Add here with the symptom + the doctor warning that catches it.
