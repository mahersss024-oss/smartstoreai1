# Security Operations Checklist

Last reviewed: 2026-10-02

## Render

- Use a supported Node runtime for production: `>=22 <25`.
- Keep `AUTH_SECRET` long, random, and different from development.
- Do not expose object storage secret keys to the browser.
- Database service and web service should use private/internal connection strings where possible.
- Restrict dashboard access to trusted maintainers with MFA.
- Keep deploy logs free of tokens, cookies, OAuth codes, and object storage signatures.

## Cloudflare / R2

- R2 access key used by the app should be scoped to the image bucket only.
- Prefer write/delete permissions only for the required bucket, not account-wide admin permissions.
- Public image domain should point only to the intended bucket/public path.
- Cache rule for images may be long-lived; API cache rules must not cache authenticated or mutating API responses.
- Cloudflare API token for purge should be scoped to the single zone and cache purge permission only.

## OAuth

- Google and Apple callback URLs must exactly match `https://souqhamad.com/api/auth/...`.
- Do not add wildcard callback URLs.
- Rotate OAuth client secrets if they were ever pasted into chat, logs, screenshots, or support tickets.

## Release Gate

- Run `pnpm test` for touched areas.
- Run `pnpm exec tsc --noEmit`.
- Run `pnpm build`.
- Run `pnpm audit --audit-level moderate` on a supported Node version.
