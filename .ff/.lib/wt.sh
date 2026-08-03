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
      BEGIN { path = ""; folder = "" }
      /^worktree / {
        path = $2
        folder = path
        sub(".*/", "", folder)
      }
      /^branch / {
        branch = $2
        sub(/^refs\/heads\//, "", branch)
        printf "%s\t%-28s\t%s\n", path, folder, branch
        path = ""
        folder = ""
      }
      /^detached/ {
        printf "%s\t%-28s\t%s\n", path, folder, "(detached)"
        path = ""
        folder = ""
      }
    ' | fzf \
      --delimiter=$'\t' \
      --with-nth=2,3 \
      --accept-nth=1 \
      --prompt='worktree> ' \
      --header=$'FOLDER                        BRANCH' \
      --preview='printf "%s" {1}' \
      --preview-window='down:1:wrap' \
      --height=~40%
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

# Filesystem + tmux-safe name derived from a branch or path label.
wt_sanitize() {
  local s=$1
  s=${s//\//-}
  s=${s//./-}
  s=${s//[^a-zA-Z0-9_-]/-}
  while [[ "$s" == *--* ]]; do
    s=${s//--/-}
  done
  s=${s#-}
  s=${s%-}
  printf '%s' "$s"
}

# Print the main (first) worktree path for the current repository.
wt_main_path() {
  wt_ensure_git_repo || return 1
  git worktree list --porcelain | awk '/^worktree / { print $2; exit }'
}

# Print a sibling worktree path: parent-of-main/<folder>.
wt_sibling_path() {
  local folder=$1
  local main_path
  main_path=$(wt_main_path) || return 1
  printf '%s/%s\n' "$(dirname "$main_path")" "$folder"
}

# Create a worktree at a sibling path. Branch defaults to folder name.
wt_add() {
  local folder=$1
  local branch=${2:-frankief-$folder}

  wt_ensure_git_repo || return 1

  if [[ -z "$folder" || "$folder" == */* || "$folder" == "." || "$folder" == ".." ]]; then
    echo "error: folder must be a single directory name" >&2
    return 1
  fi

  local worktree_path
  worktree_path=$(wt_sibling_path "$folder") || return 1

  if [[ -e "$worktree_path" ]]; then
    echo "error: path already exists: $worktree_path" >&2
    return 1
  fi

  git fetch --quiet origin "$branch" 2>/dev/null || true

  if git show-ref --verify --quiet "refs/heads/$branch"; then
    git worktree add "$worktree_path" "$branch"
  elif git show-ref --verify --quiet "refs/remotes/origin/$branch"; then
    git worktree add -b "$branch" "$worktree_path" "origin/$branch"
  else
    echo "branch '$branch' not found; creating from origin/master..." >&2
    git fetch --quiet origin master 2>/dev/null || true
    if ! git show-ref --verify --quiet "refs/remotes/origin/master"; then
      echo "error: origin/master not found; cannot create branch '$branch'" >&2
      return 1
    fi
    git worktree add -b "$branch" "$worktree_path" "origin/master"
  fi

  printf '%s\n' "$worktree_path"
}

# Print branch name for a worktree path, or empty when detached.
wt_branch_for_path() {
  local path=$1
  git -C "$path" branch --show-current 2>/dev/null || true
}

# Tmux session name for a worktree (matches ff devbox go naming).
wt_session_for_path() {
  local path=$1
  local branch
  branch=$(wt_branch_for_path "$path")
  if [[ -n "$branch" ]]; then
    wt_sanitize "$branch"
  else
    wt_sanitize "$(basename "$path")"
  fi
}

# Print worktree rows as: path<TAB>branch<TAB>reason
# reason is empty for normal rows; used by wt clean for stale entries.
wt_list_entries() {
  wt_ensure_git_repo || return 1

  local main_path
  main_path=$(wt_main_path)

  local path branch
  while IFS= read -r line || [[ -n "${line:-}" ]]; do
    if [[ "$line" == worktree* ]]; then
      path=${line#worktree }
    elif [[ "$line" == branch* ]]; then
      branch=${line#branch }
      branch=${branch#refs/heads/}
      printf '%s\t%s\t\n' "$path" "$branch"
      path=
      branch=
    elif [[ "$line" == detached ]]; then
      printf '%s\t(detached)\t\n' "$path"
      path=
    elif [[ -z "$line" && -n "${path:-}" ]]; then
      path=
    fi
  done < <(git worktree list --porcelain)
}
