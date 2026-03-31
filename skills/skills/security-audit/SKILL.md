---
name: security-audit
description: >-
  Security audit skill. Use when asked to "audit security", "check for
  vulnerabilities", "security review", "pentest", or when evaluating code
  that handles auth, user input, secrets, or external data. Runs a phased
  scan covering OWASP Top 10 and STRIDE threat modeling.
---

# Security Audit

Phased security scan. Each phase is independent — skip phases that do not apply
to the codebase.

## Phase 1: Scope

1. Identify the attack surface: what accepts external input? (HTTP endpoints,
   CLI args, file uploads, WebSocket messages, IPC, environment variables)
2. Identify trust boundaries: where does data cross from untrusted to trusted?
3. List authentication and authorization mechanisms in use
4. Note the deployment model (server, serverless, desktop, CLI)

## Phase 2: Input Validation

For each entry point identified in Phase 1:

- Is user input validated and sanitized before use?
- Are SQL queries parameterized (not string-interpolated)?
- Is HTML output escaped to prevent XSS?
- Are file paths validated to prevent path traversal?
- Are file uploads constrained by type and size?
- Is deserialization of untrusted data avoided or sandboxed?

## Phase 3: Auth and Session

- Are all protected routes/endpoints checked for authentication?
- Is authorization checked per-resource, not just per-route?
- Are session tokens generated with sufficient entropy?
- Are tokens stored securely (httpOnly, secure, sameSite)?
- Is there rate limiting on login/auth endpoints?
- Are password reset flows safe from enumeration?

## Phase 4: Secrets

1. `grep -r` for common secret patterns in source (API keys, tokens, passwords,
   connection strings) — exclude `node_modules`, `.git`, lock files
2. Check `git log --all -p -S "password\|secret\|api_key\|token"` for secrets
   that were committed and later removed (they are still in history)
3. Verify `.gitignore` covers `.env`, credential files, and key material
4. Check that secrets are not logged, included in error responses, or exposed
   in client-side bundles

## Phase 5: Dependencies

1. Check for known vulnerabilities: `npm audit` / `pip audit` / equivalent
2. Look for unmaintained dependencies (no updates in 2+ years)
3. Check that lockfiles are committed and dependencies are pinned

## Phase 6: CI/CD

If CI/CD config exists (`.github/workflows/`, `.gitlab-ci.yml`, etc.):

- Are third-party actions/images pinned to SHA, not floating tags?
- Does `pull_request_target` grant write access to untrusted PRs?
- Are secrets available only to the workflows that need them?
- Can a malicious PR modify CI config to exfiltrate secrets?

## Phase 7: STRIDE Threat Model

For each component identified in Phase 1, evaluate:

- **Spoofing** — Can an attacker impersonate a legitimate user or service?
- **Tampering** — Can data be modified in transit or at rest without detection?
- **Repudiation** — Are security-relevant actions logged with enough detail for audit?
- **Information Disclosure** — Can sensitive data leak through errors, logs, or side channels?
- **Denial of Service** — Are there unbounded operations an attacker can trigger?
- **Elevation of Privilege** — Can a low-privilege user reach admin functionality?

## Phase 8: Report

For each finding:

1. **Severity**: Critical / High / Medium / Low / Informational
2. **Location**: file path and line range
3. **Description**: what the vulnerability is
4. **Impact**: what an attacker could do
5. **Recommendation**: specific fix, not generic advice

## Rules

- Only report findings you can point to in the code — no hypotheticals
- If a finding requires a specific runtime condition to exploit, state the condition
- Do not report style issues, linting violations, or non-security code quality as security findings
- Distinguish between confirmed vulnerabilities and potential risks
