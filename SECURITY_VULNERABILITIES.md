# Security Vulnerabilities & Mitigations

**Last Updated:** 2025-12-11  
**Status:** Active monitoring and mitigation in place

---

## Overview

This document tracks known security vulnerabilities in dependencies and their mitigation status. All HIGH and CRITICAL vulnerabilities are addressed through package overrides or documented limitations.

---

## Core Dependencies (Fixed)

### ✅ Fixed via Package Overrides

| Package | Vulnerability | Fixed Version | Status |
|---------|---------------|---------------|--------|
| `qs` | Prototype pollution (HIGH) | `>=6.13.0` | ✅ Fixed |
| `socket.io-parser` | Prototype pollution (CRITICAL) | `>=4.2.4` | ✅ Fixed |
| `@hapi/hoek` | Prototype pollution (HIGH) | `>=9.0.3` | ✅ Fixed (replacement for `hoek`) |
| `hawk` | ReDoS, Resource consumption (HIGH) | `>=9.0.1` | ✅ Fixed |
| `playwright` | SSL certificate verification (HIGH) | `>=1.55.1` | ✅ Fixed |
| `ai` | Multiple vulnerabilities | `>=5.0.52` | ✅ Fixed |
| `got` | Multiple vulnerabilities | `>=11.8.5` | ✅ Fixed |
| `tunnel-agent` | Multiple vulnerabilities | `>=0.6.0` | ✅ Fixed |
| `tsup` | XSS/DOM Clobbering (CVE-2024-53384) | `>=8.5.1` | ✅ Fixed |
| `tough-cookie` | Multiple vulnerabilities | `>=4.1.3` | ✅ Fixed |
| `node-fetch` | Multiple vulnerabilities | `>=2.6.7` | ✅ Fixed |
| `express` | Multiple vulnerabilities | `>=4.21.0` | ✅ Fixed |
| `ws` | Multiple vulnerabilities | `>=8.18.0` | ✅ Fixed |
| `body-parser` | Multiple vulnerabilities | `>=1.20.3` | ✅ Fixed |
| `cookie` | Multiple vulnerabilities | `>=0.7.0` | ✅ Fixed |
| `path-to-regexp` | Multiple vulnerabilities | `>=0.1.10` | ✅ Fixed |
| `send` | Multiple vulnerabilities | `>=0.19.0` | ✅ Fixed |
| `fresh` | Multiple vulnerabilities | `>=0.5.2` | ✅ Fixed |
| `debug` | Multiple vulnerabilities | `>=2.6.9` | ✅ Fixed |
| `nanoid` | Multiple vulnerabilities | `>=5.0.9` | ✅ Fixed |
| `form-data` | Multiple vulnerabilities | `>=4.0.0` | ✅ Fixed |
| `jsondiffpatch` | Multiple vulnerabilities | `>=0.7.2` | ✅ Fixed |
| `engine.io-client` | Multiple vulnerabilities | `>=6.6.2` | ✅ Fixed |
| `parse-duration` | Multiple vulnerabilities | `>=2.1.0` | ✅ Fixed |
| `tmp` | Multiple vulnerabilities | `>=0.2.3` | ✅ Fixed |
| `undici` | Multiple vulnerabilities | `>=6.21.0` | ✅ Fixed |
| `esbuild` | Multiple vulnerabilities | `>=0.25.0` | ✅ Fixed |
| `mime` | Multiple vulnerabilities | `>=4.0.0` | ✅ Fixed |
| `morgan` | Multiple vulnerabilities | `>=1.10.0` | ✅ Fixed |
| `uglify-js` | Multiple vulnerabilities | `>=3.19.0` | ✅ Fixed |
| `next` | Multiple vulnerabilities | `>=15.1.0` | ✅ Fixed |
| `negotiator` | Multiple vulnerabilities | `>=0.6.4` | ✅ Fixed |
| `axios` | Multiple vulnerabilities | `>=1.7.4` | ✅ Fixed |
| `hono` | Multiple vulnerabilities | `>=4.6.10` | ✅ Fixed |
| `js-yaml` | Multiple vulnerabilities | `>=4.0.0` | ✅ Fixed |
| `socket.io` | Multiple vulnerabilities | `>=4.8.0` | ✅ Fixed |
| `glob` | Command injection (HIGH) | `>=11.0.0` | ✅ Fixed (library usage only) |

**Note:** The `glob` vulnerability (GHSA-5j98-mcp5-4vw2) affects the CLI tool, not the library. Since we only use the library (not the CLI), the override is sufficient.

---

## Vendor Dependencies (Documented Limitations)

### ⚠️ Vulnerable Packages in Vendor Code

These packages are dependencies of vendor code (elizaos, babylon, hyperscape) and cannot be easily overridden without breaking vendor functionality:

| Package | Vulnerability | Severity | Location | Mitigation |
|---------|---------------|----------|----------|------------|
| `hoek` | Prototype pollution (GHSA-c429-5p7v-vgjp) | HIGH | Vendor packages (`eliza-otc-desk`) | ⚠️ Documented limitation. Package replaced by `@hapi/hoek` (which is fixed). Vendor code uses old package. |
| `xlsx` | Prototype pollution, ReDoS (GHSA-4r6h-8v6p-xvw6, GHSA-5pgg-2g8v-p4x9) | HIGH | `eliza-cloud-v2` | ⚠️ Documented limitation. No fix available yet. Only used in vendor code. |
| `timespan` | ReDoS (GHSA-f523-2f5j-gfcg) | HIGH | `eliza-otc-desk` | ⚠️ Documented limitation. No fix available. Only used in vendor code. |
| `bigint-buffer` | Buffer overflow (GHSA-3gc7-fjrx-p6mg) | HIGH | `eliza-cloud-v2` | ⚠️ Documented limitation. No fix available. Only used in vendor code. |

**Mitigation Strategy:**
- These packages are only used in vendor code (not in our core codebase)
- We monitor for updates from vendors
- If critical, we can fork vendor packages and replace dependencies
- Regular security audits alert us to new vulnerabilities

**Current Status:** These vulnerabilities are documented and monitored. They do not affect our core codebase functionality. Vendor packages are isolated and can be updated or replaced independently.

---

## Monitoring & Verification

### Automated Checks

1. **Security Audit Script:** `bun run verify:security`
   - Runs `bun audit --audit-level=high`
   - Checks for package overrides
   - Verifies security documentation exists
   - Reports vendor vs core vulnerabilities separately

2. **CI/CD Integration:**
   - Security audit runs on every PR
   - Fails build if new HIGH/CRITICAL vulnerabilities are introduced
   - Alerts on vendor package vulnerabilities (warning only)

### Manual Checks

Run security audit manually:
```bash
bun run verify:security
```

Check for new vulnerabilities:
```bash
bun audit --audit-level=high
```

---

## Package Override Strategy

### How Overrides Work

Package overrides in `package.json` force all dependencies (including nested ones) to use the specified version range. This ensures vulnerable versions cannot be installed.

### Adding New Overrides

When a new HIGH/CRITICAL vulnerability is discovered:

1. **Check if fix exists:**
   ```bash
   bun audit --audit-level=high
   ```

2. **Find fixed version:**
   - Check GitHub Security Advisories
   - Check npm security advisories
   - Check package changelog

3. **Add override:**
   ```json
   "overrides": {
     "vulnerable-package": ">=fixed-version"
   }
   ```

4. **Update this document:**
   - Add to "Fixed via Package Overrides" table
   - Document the vulnerability ID

5. **Test:**
   ```bash
   bun install
   bun run verify:security
   ```

### Blocking Vulnerable Packages

If no fix exists, block the package:
```json
"overrides": {
  "vulnerable-package": ">=999.0.0"
}
```

This prevents installation and will cause build failures if the package is required, alerting us to the issue.

---

## Vendor Package Security

### Current Approach

Vendor packages (in `vendor/` directory) are treated as third-party code:
- Security vulnerabilities are documented but not fixed directly
- Overrides still apply to vendor dependencies
- Vendor updates are tracked separately

### Vendor Update Process

1. **Monitor vendor updates:**
   ```bash
   bun run vendor:update
   ```

2. **Review security:**
   ```bash
   bun audit --audit-level=high | grep vendor
   ```

3. **Update vendor:**
   ```bash
   bun run vendor:sync
   ```

4. **Verify:**
   ```bash
   bun run verify:security
   ```

---

## Incident Response

### If a Vulnerability is Discovered

1. **Immediate Actions:**
   - Check if override exists
   - If not, add override immediately
   - Update this document
   - Run `bun run verify:security`

2. **If No Fix Exists:**
   - Block package via override `>=999.0.0`
   - Document in this file
   - Create issue to track resolution
   - Consider removing affected functionality

3. **If Vendor Package:**
   - Document in "Vendor Dependencies" section
   - Check if vendor has fix
   - Consider forking vendor package if critical

---

## References

- [GitHub Security Advisories](https://github.com/advisories)
- [npm Security Advisories](https://www.npmjs.com/advisories)
- [Snyk Vulnerability Database](https://security.snyk.io/)
- [OSV Vulnerability Database](https://osv.dev/)

---

## Changelog

- **2025-12-11:** Initial security documentation
  - Documented all package overrides
  - Added vendor dependency tracking
  - Created automated verification script
  - Fixed security audit parsing for bun audit output
  - Added new package overrides: ai, got, tunnel-agent, tsup, tough-cookie, node-fetch
