# Shared git worktree helpers. Source from ff wt scripts:
#   # shellcheck source=/dev/null
#   source "${FF_SCRIPT_HOME}/.lib/wt.sh"

wt_ensure_git_repo() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    echo "error: not inside a git repository" >&2
    return 1
  fi
}

# Print worktree paths, one per line.
wt_paths() {
  wt_ensure_git_repo || return 1
  git worktree list --porcelain | awk '/^worktree / { print $2 }'
}

# Interactively pick a worktree path with fzf. Prints the selected path to stdout.
wt_pick() {
  wt_ensure_git_repo || return 1

  if ! command -v fzf >/dev/null 2>&1; then
    echo "error: fzf not found" >&2
    return 1
  fi

  local selection
  selection=$(
    git worktree list --porcelain | awk '
      BEGIN { path = "" }
      /^worktree / { path = $2 }
      /^branch / {
        branch = $2
        sub(/^refs\/heads\//, "", branch)
        printf "%s\t%s\n", path, branch
        path = ""
      }
      /^detached/ {
        printf "%s\t(detached)\n", path
        path = ""
      }
    ' | fzf \
      --delimiter=$'\t' \
      --with-nth=2,1 \
      --accept-nth=1 \
      --prompt='worktree> '
  ) || return 1

  [[ -n "$selection" ]] || return 1
  printf '%s\n' "$selection"
}

# Resolve a worktree path from an explicit argument or the fzf picker.
wt_resolve_path() {
  local path=${1:-}

  if [[ -n "$path" ]]; then
    printf '%s\n' "$path"
    return 0
  fi

  wt_pick
}
