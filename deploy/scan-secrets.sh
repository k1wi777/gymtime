#!/usr/bin/env bash
# V18 (part 2): looks for secrets in the repository.
#
# Scans every tracked file (`git ls-files`, so an ignored .env is never read)
# and the whole git history for credential-shaped strings. It NEVER prints the
# secret it finds: only the file (or commit), the line number and the rule.
# Placeholders from the *.example files and test fixtures are filtered by the
# allow-list below. A finding is a stop: rotate the secret and clean the
# history before releasing.
#
#   deploy/scan-secrets.sh
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# name|extended regex (kept deliberately specific to avoid noise)
RULES=(
  'private-key|-----BEGIN [A-Z ]*PRIVATE KEY-----'
  'aws-access-key|AKIA[0-9A-Z]{16}'
  'github-token|gh[pousr]_[A-Za-z0-9]{36,}'
  'slack-token|xox[baprs]-[A-Za-z0-9-]{10,}'
  'jwt|eyJ[A-Za-z0-9_-]{15,}\.eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}'
  'device-token|gt_dev_[A-Za-z0-9_-]{43}'
  'url-password|[a-z]+://[^/[:space:]:@]+:[^/[:space:]@${}]{8,}@[a-z0-9.-]+'
  'secret-assignment|(PASSWORD|SECRET|API_KEY|ENCRYPTION_KEY|DEVICE_TOKEN)[A-Z_]*[=:] *["'"'"']?[A-Za-z0-9+/=_-]{24,}'
)
# Lines that are known placeholders or test fixtures.
ALLOW='change-me|openapi-export|replace|example|placeholder|gymtime_dev_password|ci_password|\$\{|<[a-z-]+>'

found=0
report() { # report <rule> <where> <line>
  echo "FOUND  rule=$1  $2:$3"
  found=1
}

echo "== Tracked files =="
while IFS= read -r file; do
  [[ -f "$file" ]] || continue
  case "$file" in *.pdf|*package-lock.json|*.png|*.jpg|*.ico) continue ;; esac
  for rule in "${RULES[@]}"; do
    name="${rule%%|*}"; re="${rule#*|}"
    while IFS=: read -r line text; do
      [[ -n "$line" ]] || continue
      if grep -Eiq "$ALLOW" <<<"$text"; then continue; fi
      report "$name" "$file" "$line"
    done < <(grep -InE -e "$re" -- "$file" 2>/dev/null || true)
  done
done < <(git ls-files)

echo "== Git history =="
commits="$(git rev-list --all | wc -l)"
for rule in "${RULES[@]}"; do
  name="${rule%%|*}"; re="${rule#*|}"
  # Candidates: (commit, file) pairs whose diff touches a line matching the rule.
  while IFS=$'\t' read -r commit file; do
    [[ -n "$commit" && -n "$file" ]] || continue
    # Only lines ADDED by the commit, minus the placeholders of the allow-list.
    hits="$(git show --format= -U0 "$commit" -- "$file" 2>/dev/null | grep -E '^\+[^+]' | grep -E -e "$re" | grep -Eiv "$ALLOW" | wc -l)"
    if [[ "$hits" -gt 0 ]]; then
      report "$name" "commit ${commit:0:10} $file" "$hits line(s)"
    fi
  done < <(git log --all --format='%H' -G"$re" --name-only --pretty=format:'@%H' | awk '/^@/{c=substr($0,2);next} NF{print c "\t" $0}')
done
echo "scanned $commits commit(s)"

if git ls-files | grep -Eq '(^|/)\.env($|\.[^e])|(^|/)\.env\.[^/]*$' ; then
  if git ls-files | grep -E '(^|/)\.env(\..*)?$' | grep -Ev '\.example$' | grep -q .; then
    echo "FOUND  rule=env-file-tracked  (a real .env file is tracked by git)"
    found=1
  fi
fi

if [[ $found -ne 0 ]]; then
  echo "FAIL: possible secrets found (values not shown). Review each location; rotate and clean the history if any is real." >&2
  exit 1
fi
echo "OK: no secrets found."
