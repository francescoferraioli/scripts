# maldini

Canva work on the Maldini Coder box (`coder.frankief/maldini`): worktree under `~/work/`, tmux session, optional command.

## Actions

| Action | Usage |
| --- | --- |
| `go` | `ff maldini go <branch-or-pr-url> [-- <command...>]` |
| `green-pr` | `ff maldini green-pr <pr-url>` |
| `merge-pr` | `ff maldini merge-pr <pr-url>` |

## `go`

Opens (or attaches) a Maldini worktree + tmux session for a branch.

- Branch name: `ff maldini go frankief-my-branch`
- PR URL: `ff maldini go https://github.com/canva/canva/pull/12345` (resolved to the PR head branch)

## `green-pr` / `merge-pr`

Require a full GitHub PR URL (not a bare number). Both pass that URL to `go`, then start Claude with the matching skill:

```bash
ff maldini green-pr https://github.com/canva/canva/pull/12345
ff maldini merge-pr https://github.com/canva/canva/pull/12345
```

If green-pr or merge-pr is not what you want, the same URL works with `go` alone:

```bash
ff maldini go https://github.com/canva/canva/pull/12345
```
