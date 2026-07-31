# Shared devbox helpers. Source from ff devbox scripts:
#   # shellcheck source=/dev/null
#   source "${FF_SCRIPT_HOME}/.lib/devbox.sh"
#
# When ff devbox all lists exactly one workspace, devbox_prepend_if_omitted
# re-execs the caller with that devbox when no args are passed, or when $1
# is set but not a known devbox name (or "all").

_devbox_all_names() {
  ff devbox all
}

_devbox_is_known_name() {
  local name=$1
  shift
  local -a all_devboxes=("$@")

  [[ "$name" == "all" ]] && return 0
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

# Usage: devbox_prepend_if_omitted "$0" "$@"
# Re-execs with the sole devbox when args are omitted or $1 is not a devbox name.
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

  _devbox_is_known_name "$1" "${all_devboxes[@]}" && return 0

  _devbox_reexec "$script" "$sole" "$@"
}
