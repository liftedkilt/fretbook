# Working on Fretbook as an agent

Several coding agents (Claude Code, Cursor, Antigravity, and others) work on this repository at the same time, each from a GitHub issue. This file is how you pick work without colliding with them. Read it before you start, and read [CONTRIBUTING.md](CONTRIBUTING.md) and [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) before you write code.

The plan and the build order are in the epic, [#84](https://github.com/liftedkilt/fretbook/issues/84).

## 1. Pick an issue

An issue is available when it is **open**, labelled `agent-ready`, and has **none** of `blocked`, `needs-human`, or `in-progress`.

```sh
gh issue list -R liftedkilt/fretbook --state open --label agent-ready \
  --search '-label:blocked -label:needs-human -label:in-progress sort:created-asc' \
  --json number,title,labels --limit 100
```

Choose in this order:

1. The earliest phase in [#84](https://github.com/liftedkilt/fretbook/issues/84) that still has available issues. Phase 0 makes parallel work safe, so finish it first.
2. Then `priority:p0`, then `p1`, then `p2`.
3. Then the lowest issue number.

Skip an issue if an open pull request already mentions it (`gh pr list -R liftedkilt/fretbook --search "<number>"`), or if it shares files with work in progress (see [Hotspots](#hotspots)) and you can pick something else.

If the human who started you named an issue, work on that one.

## 2. Claim it

Claim before you write any code, so nobody else starts the same issue:

```sh
gh issue edit <N> -R liftedkilt/fretbook --add-label in-progress
gh issue comment <N> -R liftedkilt/fretbook --body "Claimed by <agent name> on branch <branch>."
```

Then read the issue's comments again. If someone else claimed it before you (an earlier claim comment), the earlier claim wins: delete your comment, and pick another issue. Do not remove the `in-progress` label in that case; it belongs to the earlier claim.

A claim goes stale when it has no open pull request and no comment or commit for 24 hours. You may take over a stale claim: comment that you are taking it over, and start a fresh branch.

## 3. Branch and open a draft PR early

- Branch from the latest `main`: `git fetch origin main && git switch -c <agent>/<N>-<short-slug> origin/main`, for example `cursor/45-ascii-tab` or `claude/27-playwright-e2e`.
- Push early and open a **draft** pull request whose body contains `Closes #<N>`. The draft is the strongest signal to other agents that the issue is taken.
- One issue per pull request. Never push to another agent's branch.
- Commit messages and PR titles use Conventional Commits (`feat: …`, `fix: …`, `test: …`, `ci: …`, `docs: …`).

## 4. Do the work

- Do what the issue's **Scope** and **Acceptance criteria** say. If you find more that should be done, open a new issue for it instead of growing the PR.
- An issue that starts with **Blocked by** must not be started until every blocker is closed, even if the label is missing.
- Follow the **Definition of done** at the bottom of the issue. In short:
  - Tests for the new behaviour: pytest for the server, Vitest for `web/src/lib`, Playwright for user flows once the e2e suite exists.
  - Every check in [CONTRIBUTING.md → Checks](CONTRIBUTING.md#checks) passes locally before you mark the PR ready.
  - API change: run `make openapi api-types` and commit `openapi.json` and `web/src/lib/api-types.ts`. Never edit `api-types.ts` by hand.
  - Every new UI string goes through `t()` and is added to `web/src/locales/en.json` **and** `pt-BR.json`. A machine translation for `pt-BR` is fine; say so in the PR.
  - Schema change: a new numbered file in `fretbook/db/migrations/`. Never edit a migration that is already on `main`.
  - Update README or docs when behaviour or configuration changes, and remove the item from `ROADMAP.md` if it is listed there.
- A frontend-only PR gets the `ui-only` label (see [web/README.md](web/README.md#the-ui-only-label)).
- No copyrighted songs in fixtures. Write your own, or use public-domain material, and note where it came from.

### Hotspots

Many agents touch these files. Keep your edits to them small, and expect to rebase:

| File | How to avoid conflicts |
| --- | --- |
| `openapi.json`, `web/src/lib/api-types.ts` | Never resolve a conflict by hand: take `main`'s version, then regenerate with `make openapi api-types`. |
| `web/src/locales/*.json` | Put a feature's strings under its own new top-level key, so additions don't interleave. |
| `fretbook/db/migrations/` | Before merging, rebase. If another PR took your number, rename your file to the next free number. |
| `web/src/App.svelte`, `fretbook/api/routes.py` | Add new components and new route modules rather than growing these files; register them with one line. |
| `.github/workflows/` | Add a new job or workflow rather than restructuring an existing one, unless the issue asks for it. |

## 5. Finish

1. Rebase on the latest `main`, regenerate any generated files, and run every check again.
2. Fill in the PR description: what changed, how you tested it, screenshots for UI changes, and anything you left out of scope (with links to the follow-up issues you opened).
3. Mark the PR ready for review. **Do not merge it yourself**; merging is the maintainer's call.
4. If CI fails after you mark the PR ready, fix it on the same branch.

When the PR merges, the issue closes, and the `Unblock issues` workflow (`.github/workflows/unblock.yml`) removes `blocked` from every issue whose blockers are now all closed.

## When you get stuck

- **The issue is unclear or needs a decision** (product, licensing, credentials, infrastructure): comment with the question and the options you see, add `needs-human`, remove `in-progress`, and pick another issue.
- **The issue is too big for one PR**: comment with a proposed split, open the parts as new issues (copy the labels, and add `Blocked by` lines where they depend on each other), and continue with the first part.
- **You have to stop before finishing**: push what you have, leave the PR as a draft, and comment on the issue with where you got to and what is left. Remove `in-progress` so another agent can continue from your branch.
- **You find a bug outside your issue**: open a new issue labelled `bug`, and don't fix it in your PR unless it blocks you.
