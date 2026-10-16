# Security policy

## Project status

DSH Trace Studio is a **developer preview**. It has not been security-audited or fully validated against a production DSH installation. No release should be assumed production-ready.

## Data handled by the plugin

The plugin can expose model messages, provider-supplied reasoning, tool arguments and results, filenames, errors, tokens, and timing metadata. These may contain personal data or secrets even when common credential patterns are redacted.

- Run DSH Web on a trusted local/private endpoint protected by the host's access controls.
- Do not expose `/trace-studio/api/*` or the viewer endpoints publicly without reviewing authentication and network controls.
- Do not include authentic prompts, API keys, access tokens, or unredacted traces in GitHub issues or screenshots.
- Keep the plugin and DSH dependencies updated, and test compatibility before deployment.
- Redaction is best-effort and **not** a comprehensive data-loss-prevention guarantee.

The project has no intended external telemetry. Review modifications and dependencies before running.

## Reporting a vulnerability

Please **do not create a public issue containing exploit details or credentials**. Use GitHub's private vulnerability reporting for this repository if it is enabled, or contact the maintainer privately via their chosen channel.

Include the affected revision, DSH version, reproduction steps, and an impact summary using synthetic data wherever possible.
