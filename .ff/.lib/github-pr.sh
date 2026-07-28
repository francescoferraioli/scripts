# Shared helpers for GitHub PR URL handling. Source from ff scripts:
#   # shellcheck source=/dev/null
#   source "${FF_SCRIPT_HOME}/.lib/github-pr.sh"

is_github_pr_url() {
  # Full https GitHub pull URL only (not a bare PR number).
  [[ "${1:-}" =~ ^https://github\.com/[^/]+/[^/]+/pull/[0-9]+([/?#].*)?$ ]]
}
