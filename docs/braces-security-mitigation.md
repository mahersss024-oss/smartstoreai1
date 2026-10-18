# Removal Of The Braces Dependency

Reviewed 2026-10-18. Advisory: GHSA-vfj7-8cjw-p6xm / CVE-2026-93687.

## Resolution

The original chain was `eslint-config-next -> @next/eslint-plugin-next ->
fast-glob -> micromatch -> braces`. The previous local braces depth patch
mitigated recursive input but did not make the version-based audit pass.
That patch and its regression tests have now been removed and superseded.

The version-scoped pnpm override
`@next/eslint-plugin-next@16.4.0>fast-glob: npm:tinyglobby@0.2.17` substitutes
only this plugin's glob dependency. Tinyglobby uses fdir and picomatch instead
of micromatch/braces. The locked dependency graph contains neither braces nor
micromatch nor the original fast-glob package. No advisory is ignored, no
version is falsified, and the CI audit command is unchanged.

The plugin uses just `globSync(pattern, { onlyDirectories: true })` in its
root-directory discovery helper. Tinyglobby returns relative paths by default,
including for absolute inputs. A small version-pinned Next.js plugin patch
adds `absolute: require('node:path').isAbsolute(rootDir)` to preserve the
original absolute/relative behavior. The patch is a compatibility adjustment,
not a hidden security exception. Its hash is tracked in pnpm-lock.yaml.

No application, authorization, database or marketplace behavior was changed.
The 113 effective ESLint rules and their options have an identical SHA-256
fingerprint before and after replacement for both TSX and TypeScript inputs.
The existing React Hooks exceptions are unchanged. A live lint test confirms
that the Next.js synchronous-script rule still detects a violation.

## Verification

Focused tests cover the locked graph, literal/absolute/glob/brace/array roots,
directory-only results, nonexistent roots, Unicode paths, negative patterns,
the exact effective rule fingerprint and an actual Next.js rule violation.
`pnpm verify` passed end to end: TypeScript, full ESLint, 742 Node tests
(12 database-gated skips, zero failures), optimized production build and the
unchanged full audit command. The audit reports no known vulnerabilities and
exits zero. Four focused replacement/compatibility tests passed as part of
the full suite. Browser end-to-end tests were not rerun for this tooling-only
change; no claim of a fresh full browser matrix is made.

An independent clean `pnpm install --frozen-lockfile --ignore-scripts` also
passed using copied manifests and the compatibility patch. Resolving modules
inside that clean installation confirmed that neither braces nor micromatch
exists in its module resolution chain. No real service credentials were used.

Old local node_modules entries can remain on disk from earlier installations;
their presence is not the resolved dependency graph. The separate clean-install
check verifies absence without relying on these cached artifacts.

## Maintenance

The override and compatibility patch are intentionally scoped to plugin 16.4.0.
On a plugin upgrade, review every glob call and run the compatibility tests
and full audit. Prefer an upstream dependency removal when available. The
tests deliberately fail if the old affected chain returns or rules change
without review. This is not a promise that the replacement has no possible
future vulnerabilities; the normal audit gate remains enabled.

Sources:
- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://github.com/SuperchupuDev/tinyglobby

After successful local verification, the user authorized committing and pushing
this dependency removal on 2026-10-18. Remote CI and production deployment must
still be checked independently; local verification does not certify either.
