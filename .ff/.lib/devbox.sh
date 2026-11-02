# Shared devbox helpers. Source from ff devbox scripts:
#   # shellcheck source=/dev/null
#   source "${FF_SCRIPT_HOME}/.lib/devbox.sh"
#
# When ff devbox all lists exactly one workspace, devbox_prepend_if_omitted
# re-execs the caller with that devbox when no args are passed, or when the
# first non-flag arg is not a known devbox name (or "all"). Leading flags
# (args starting with -) are kept in place.
#
# Forge Cloud workspaces are still Coder devboxes, but the name is
# forge-<16 hex chars> (owner forge-cloud). Those use a different SSH
# hostname and an owner-qualified coder CLI ref. Plain "forge" is the older
# frankief-owned workspace and stays on coder.frankief/forge.

_devbox_all_names() {
  ff devbox all
}

# forge-22e900d4ec0043b3, not the frankief workspace named forge.
devbox_is_forge_cloud() {
  [[ "$1" =~ ^forge-[0-9a-f]{16}$ ]]
}

# OpenSSH host. Forge Cloud is agent.workspace.owner.coder.
devbox_ssh_host() {
  local name=$1
  if devbox_is_forge_cloud "$name"; then
    printf 'main.%s.forge-cloud.coder' "$name"
  else
    printf 'coder.frankief/%s' "$name"
  fi
}

# coder start/stop/show argument. Unqualified names resolve as owner:me.
devbox_coder_workspace() {
  local name=$1
  if devbox_is_forge_cloud "$name"; then
    printf 'forge-cloud/%s' "$name"
  else
    printf '%s' "$name"
  fi
}

# coder list --search value for one workspace.
devbox_coder_list_search() {
  local name=$1
  if devbox_is_forge_cloud "$name"; then
    printf 'owner:forge-cloud name:%s' "$name"
  else
    printf 'owner:me name:%s' "$name"
  fi
}

# JSON array of owner:me workspaces, plus one owner:forge-cloud name:<name>
# query per Forge Cloud argument. Status reads that row from the merge.
devbox_coder_list_json() {
  local mine name
  local -a forge_names=()
  mine=$(coder list -o json --search 'owner:me')
  for name in "$@"; do
    if devbox_is_forge_cloud "$name"; then
      forge_names+=("$name")
    fi
  done
  if [[ ${#forge_names[@]} -eq 0 ]]; then
    printf '%s\n' "$mine"
    return 0
  fi

  {
    printf '%s\n' "$mine"
    for name in "${forge_names[@]}"; do
      printf '\n\x1e\n'
      coder list -o json --search "$(devbox_coder_list_search "$name")"
    done
  } | python3 -c '
import json
import sys

seen = set()
merged = []
for chunk in sys.stdin.read().split("\n\x1e\n"):
    chunk = chunk.strip()
    if not chunk:
        continue
    for workspace in json.loads(chunk):
        workspace_id = workspace.get("id")
        if workspace_id in seen:
            continue
        seen.add(workspace_id)
        merged.append(workspace)
print(json.dumps(merged))
'
}

_devbox_is_known_name() {
  local name=$1
  shift
  local -a all_devboxes=("$@")

  [[ "$name" == "all" ]] && return 0
  devbox_is_forge_cloud "$name" && return 0
  local d
  for d in "${all_devboxes[@]}"; do
    [[ "$name" == "$d" ]] && return 0
  done
  return 1
}

_devbox_reexec() {
  local script=$1
  shift
  echo "ff devbox $(basename "$script") $*" >&2
  exec bash "$script" "$@"
}

devbox_status() {
  # ff used to exit 0 even when status failed, leaving stdout empty.
  local status
  status=$(ff devbox status --state "$1" 2>/dev/null || echo unknown)
  echo "${status:-unknown}"
}

# Prints a skip line and returns 1 when the workspace is not running.
devbox_skip_unless_running() {
  local name=$1
  local status
  status=$(devbox_status "$name")
  [[ "$status" == "running" ]] && return 0
  echo "$name: skipping (status: $status)" >&2
  return 1
}

# Returns 1 with an error when the workspace is not running.
devbox_require_running() {
  local name=$1
  local status
  status=$(devbox_status "$name")
  [[ "$status" == "running" ]] && return 0
  echo "error: $name is not running (status: $status)" >&2
  echo "wake it with: ff devbox wake $name" >&2
  return 1
}

# Usage: devbox_prepend_if_omitted "$0" "$@"
# Re-execs with the sole devbox when args are omitted or the first non-flag
# arg is not a known devbox name.
devbox_prepend_if_omitted() {
  local script=$1
  shift

  local -a all_devboxes
  read -r -a all_devboxes <<< "$(_devbox_all_names)"
  [[ ${#all_devboxes[@]} -eq 1 ]] || return 0

  local sole="${all_devboxes[0]}"

  if [[ $# -eq 0 ]]; then
    _devbox_reexec "$script" "$sole"
  fi

  local -a prefix=()
  while [[ $# -gt 0 && "$1" == -* && "$1" != "--" ]]; do
    prefix+=("$1")
    shift
  done

  if [[ $# -eq 0 ]]; then
    _devbox_reexec "$script" "${prefix[@]}" "$sole"
  fi

  _devbox_is_known_name "$1" "${all_devboxes[@]}" && return 0

  _devbox_reexec "$script" "${prefix[@]}" "$sole" "$@"
}
