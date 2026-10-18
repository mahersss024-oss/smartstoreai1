# Braces Depth Mitigation

Reviewed 2026-10-18. Advisory: GHSA-vfj7-8cjw-p6xm / CVE-2026-93687.

## Exposure Review

`pnpm why braces` resolves one installed version, 3.0.3, through:

`eslint-config-next -> @next/eslint-plugin-next -> fast-glob -> micromatch -> braces`.

The root dependency is a development dependency. No application source import
of braces, micromatch or fast-glob was found. All 93 local optimized Next.js
dependency traces were inspected; none referenced this braces package. The
App Runner startup script starts Next.js and optionally Prisma migrations,
not ESLint. Its install step includes development tooling, so the package may
still be present on disk. These findings support absence from the traced
customer runtime, not a claim that a deployed AWS filesystem was inspected.

## Upstream Check

The registry reports braces 3.0.3 as latest. The advisory lists no patched
release. The latest Next.js ESLint plugin, 16.4.2, still depends on fast-glob
3.3.1; latest micromatch is 4.0.8. An unrelated Next.js upgrade was not made
because this chain still includes the affected package.

Sources:
- https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- https://github.com/micromatch/braces/issues/70

## Local Mitigation

`patches/braces@3.0.3.patch` is registered in `pnpm.patchedDependencies` and
hashed in `pnpm-lock.yaml`. Normal installations, including frozen-lockfile
installations, apply it without a runtime monkey patch or application wrapper.

- Limit parser nesting to a fixed depth of 128, including parentheses.
- Check AST child edges iteratively before compile, expand and stringify.
- Reject excessive AST depth and repeated child nodes/cycles with a deliberate
  RangeError, rather than descending until the native call stack is exhausted.
- Parent/previous links are not traversed; normal parser-produced ASTs contain
  those intentional back-references.
- The configured limit cannot be raised using caller-supplied options.

This changes only pathological glob/AST input handling. It is not a general
resource-exhaustion defense or proof that every braces issue is fixed. Callers
must still handle invalid-pattern exceptions; an uncaught deliberate exception
can also terminate a process. No claim of remote customer exposure is made.

## Audit Behavior

The former `ignoreGhsas` entry was removed. `pnpm audit --prod --audit-level
moderate` reports no known vulnerabilities. Full `pnpm audit --audit-level
moderate` still reports this high advisory and exits nonzero: the registry
scanner matches the unchanged version, not local patched source.

Consequently `pnpm verify` and the existing CI audit gate will remain red at
the audit step until upstream metadata/dependencies are fixed or a separately
reviewed audit policy is adopted. No exception, fake version, disabled check
or new allowlist was introduced to force a green audit.

## Verification

Seven focused security regression tests pass: ordinary compilation/expansion
and glob matching, four child-process checks with 4,000 levels below the
existing input-length ceiling, direct deep/cyclic AST entry points, and patch/
audit configuration. Each child confirms it can catch the bounded rejection
and continue normally. Frozen-lockfile installation also passes.

TypeScript and optimized build passed. The complete Node regression passed:
742 passed, 12 database-gated skips, zero failures. The rebuilt 93 dependency
traces again contain no braces reference. Full ESLint passed after excluding
the temporary `.patch-work` vendor editing directory; application
and test rules remain unchanged. Cleanup of that temporary directory was
blocked by execution policy, so it remains ignored by Git and ESLint.

The user subsequently authorized committing and pushing this mitigation and
the browser CI changes on 2026-10-18, with the remaining audit failure disclosed.
This authorization does not certify successful CI or production deployment.
Revisit and retire the patch when an upstream fix is
available, rerunning these tests before removing it.
