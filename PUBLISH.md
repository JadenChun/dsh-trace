# Repository setup and release notes

**GitHub repository:** https://github.com/JadenChun/dsh-trace

The source is already committed to the `main` branch. You do **not** need to create another repository or re-upload the original ZIP.

## Clone and verify

```bash
git clone https://github.com/JadenChun/dsh-trace.git
cd dsh-trace
npm run check
npm test
npm run pack:dry
```

Requires Node.js 20+; the current scripts do not require a package install. CI runs these checks on Node 20 and 22.

## Install the local plugin

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-trace
```

Restart `dsh web` and hard-refresh the browser. The panel uses DSH's light/dark semantic CSS tokens. The local preview is at `demo/sidebar.html`, served via a local HTTP server.

## Release readiness checklist

- Verify plugin registration and SSE history/live updates against the actual installed DSH version.
- Compare the sidebar layout against DSH's native light/dark UI.
- Verify authentication and safe access to trace endpoints.
- Run `npm run check`, `npm test`, and `npm run pack:dry`.
- Review changes for secrets and confirm no real trace screenshots or fixtures are committed.
- Confirm package metadata and version before tagging or publishing.

**Current status:** v0.3.1 developer preview; live DSH integration remains unverified. Do not treat this as a production release.
