# Security Policy

## Reporting a Vulnerability

Please do not report security vulnerabilities through public GitHub issues.

Instead, open a [GitHub Security Advisory](https://github.com/ajjucoder/ContextWeave/security/advisories/new) or email the maintainer directly.

Include as much detail as possible:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix if you have one

You will receive a response within 72 hours. If the issue is confirmed, a patch will be released as soon as possible.

## Scope

ContextWeave runs entirely locally. It does not make network requests, send telemetry, or transmit data externally. The primary attack surface is:

- **Path traversal** in file indexing (mitigated — all paths validated against project root)
- **Input bounds** on MCP tool parameters (mitigated — Zod schema validation on all inputs)
- **Sensitive file exposure** via indexing (mitigated — `.env*`, `.pem`, `.key`, `credentials.json` always excluded)
