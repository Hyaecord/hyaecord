# Security Policy

## Supported Versions

Hyaecord is pre-1.0. Only the latest release (and `main`) receive security fixes.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report privately via [GitHub Security Advisories](https://github.com/Hyaecord/hyaecord/security/advisories/new). This is the same contact published in the website's [`/.well-known/security.txt`](https://hyaecord.vercel.app/.well-known/security.txt) (RFC 9116).

Please include:

- A description of the issue and its impact
- Steps to reproduce (a proof of concept helps a lot)
- Affected version/commit and platform

You can expect an acknowledgement within a few days. We'll keep you informed as we triage and fix, and we're happy to credit you in the fix's release notes unless you prefer otherwise.

## Scope notes

- **Plugins run with significant privileges.** Hyaecord aims for basic plugin sandboxing/permission boundaries where feasible, but a malicious plugin is largely outside the threat model today — only install plugins you trust. Sandbox escapes that break a boundary Hyaecord *does* enforce are in scope.
- Vulnerabilities in Discord's own services should be reported to Discord, not here.
- The website repo ([Hyaecord/website](https://github.com/Hyaecord/website)) is covered by this same policy.
