# Contributing to DSH Trace Studio

Thanks for helping improve DSH Trace Studio. This is a developer-preview plugin, so compatibility fixes, bug reports, and accessibility improvements are especially useful.

## Local setup

Requirements: Node.js 20 or newer, Git, and an installed DSH Web instance for integration testing.

```bash
git clone https://github.com/JadenChun/dsh-trace.git
cd dsh-trace
npm run check
npm test
npm run pack:dry
```

There is no frontend build step for the current implementation. The distributable JavaScript, CSS, and HTML are maintained under `lib/`.

Preview the UI with synthetic data:

```bash
python3 -m http.server 8765
# Open http://localhost:8765/demo/sidebar.html
```

To test in DSH:

```bash
dsh plugin --profile web add link:/absolute/path/to/dsh-trace
# Restart dsh web and hard-refresh the browser.
```

## Pull requests

- Create a feature branch from `main` and keep changes scoped.
- Run `npm run check` and `npm test`. Include new or updated tests for event collector changes.
- For UI changes, check a narrow sidebar in both light and dark DSH themes. Prefer native `--dsw-*` tokens over hardcoded palette colors.
- Keep the default sidebar compact; put diagnostic details behind expansion.
- Use only synthetic or properly sanitized trace examples in screenshots and tests.
- Describe what was verified locally and what still needs testing against a real DSH instance.

## Scope and privacy

Trace data may contain sensitive content. Avoid external analytics, telemetry, automatic upload, or unsanitized fixtures. Available model reasoning is not necessarily the model's complete private decision process.

The project is inspired by observability tools such as LangSmith and DSH plugins such as Think Flow; please respect upstream licenses if importing code.
