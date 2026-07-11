# Publishing

Status: **not yet published.** Packaging metadata is in place (`files`, `engines`, `license`,
`bin`); the steps below remain for whoever holds the npm account. Publishing is an outward action
— do it deliberately, not from an agent.

## Package name

The bin is **`duo`** (kept stable regardless of the npm package name, so all docs and muscle
memory survive a rename). The npm package name is still to be claimed:

- `duo` — taken on npm.
- Candidates (verify availability at publish time): **`duo-agents`** (preferred), `duoteam`,
  `duo-mcp`, or a scoped `@<org>/duo`.

Decide and squat the name early; alias the bin so docs stay stable.

## Shape decision: bundle vs. four packages

The CLI depends on three workspace packages (`@duo/shared`, `@duo/hub`, `@duo/adapters`). Two
publish strategies:

1. **Single bundled package (recommended for v1).** Bundle CLI + hub + shared + adapters +
   `dashboard/` into one tarball with a bundler (esbuild/ncc), published as `duo-agents`. One
   `npm i -g duo-agents`, no cross-package version coupling. The bundler step is the remaining
   build-pipeline work.
2. **Scoped set.** Publish `@duoagents/shared|hub|adapters|cli` together, same version, CLI
   depending on the exact versions. Simpler build, four things to keep in lockstep.

The hub's `files` already includes `dashboard/`, so the served page ships either way (verified
with `npm pack --dry-run`: `dashboard/index.html` is in the tarball).

## Steps (once name + shape are decided)

1. Bump versions across packages (or the single bundle).
2. `npm run build` at the workspace root; `npm test` (all suites green).
3. `npm pack --dry-run` in each publishable package — confirm `dist/` and (hub) `dashboard/`.
4. Containerized smoke test: `npm i -g <tarball>` → `duo doctor` → a fake-agent session, on
   clean macOS and Linux images. (This is the CI install gate the roadmap calls for.)
5. `npm publish` (with `--access public` if scoped).
6. Tag `v1.0.0`; attach the smoke-test transcript.

## Engine range

Node **>=20** (declared in every package). The MCP SDK needs 18+; 20 is the tested floor.
