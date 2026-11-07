#!/usr/bin/env bash
# V18 (part 1): dependency audit of what ships to production.
#
# `npm audit --omit=dev` in the repository root (server, shared, cli,
# simulator) and in web/. Exits 1 when it finds a HIGH or CRITICAL advisory:
# fix it or justify it explicitly (docs/runbook.md, "Auditoría de
# dependencias") before releasing. Moderate and low ones are listed only.
# Needs network access to the npm registry.
#
#   deploy/security-review.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
status=0

audit() { # audit <label> <dir>
  local label="$1" dir="$2" out
  echo "== npm audit --omit=dev ($label) =="
  if ! out="$(cd "$dir" && npm audit --omit=dev --json 2>&1)"; then :; fi
  if ! node -e '
    const raw = require("fs").readFileSync(0, "utf8");
    let data;
    try { data = JSON.parse(raw); } catch { console.error("could not read the audit output (no network?)"); process.exit(2); }
    if (data.error) { console.error("audit failed:", data.error.summary ?? data.error.code); process.exit(2); }
    const v = data.metadata.vulnerabilities;
    console.log(`info ${v.info}  low ${v.low}  moderate ${v.moderate}  high ${v.high}  critical ${v.critical}  (total ${v.total})`);
    for (const [name, item] of Object.entries(data.vulnerabilities ?? {})) {
      console.log(`  ${item.severity.padEnd(9)} ${name}${item.fixAvailable ? "  (fix available)" : ""}`);
    }
    process.exit(v.high + v.critical > 0 ? 1 : 0);
  ' <<<"$out"; then
    status=1
  fi
}

audit "root workspaces" "$ROOT"
audit "web" "$ROOT/web"

if [[ $status -ne 0 ]]; then
  echo "FAIL: high/critical advisories, or the audit could not run. Fix them or justify them in writing." >&2
else
  echo "OK: no high or critical advisories in production dependencies."
fi
exit $status
