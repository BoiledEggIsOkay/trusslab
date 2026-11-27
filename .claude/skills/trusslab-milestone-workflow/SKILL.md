---
name: trusslab-milestone-workflow
description: The working protocol for every change to TrussLab (milestones, bug fixes, refactors, test or documentation updates), from reading the code and writing a plan through tests, diff review, documentation, the report and the commit. Use it whenever you start, continue, finish or report on any TrussLab task, when the user approves a step or asks what is next, and before committing anything in this repository, even if the user only says "next", "go ahead", "proceed" or "fix this".
---

# TrussLab milestone workflow

TrussLab grows in small steps that the maintainer reviews one at a time. A step is only useful if its report is accurate: the maintainer decides what to approve from what you say passed, what you could not check, and what you noticed along the way. Work so that every claim in the report can be traced to something you ran or read.

## 1. Pin down the scope

Do the step that was requested and nothing else. When you notice another problem, write it down under "Found, not fixed" in the report instead of fixing it. Unrequested changes make the diff harder to review and put unrelated risks into one commit. Earlier examples were the D-shortcut legend bug and the D/G autosave bug: both were found during milestone 1 and fixed later as their own commit.

If a request leaves the scope or the order of steps open, ask. If it only leaves a detail open that has a sensible default, choose the default and say which one you chose.

## 2. Inspect before planning

Read the code the step touches, and its callers, rather than trusting a summary, including the summaries in these skills: the repository wins when they disagree, and then the skill needs fixing too. Note the current behaviour, the entry points, hidden dependencies (for example a function that reads UI settings), and what the existing tests already cover.

## 3. Plan

Before editing, give a short plan: the goal, the files you will change, the approach, the regression risks you found while inspecting, how you will verify the result, and what you will not be able to verify. If the user has already approved a plan, restate only what changed.

## 4. Implement

- Follow `trusslab-architecture` for where code goes, `trusslab-engineering-rules` for anything that computes or presents results, and `trusslab-ui-design` for anything visible on the page.
- Bug fix: write the regression test first and show that it fails on the unfixed code, then fix the code and show that it passes. A test that was never seen failing has not been shown to detect the bug.
- Refactor: no change in behaviour. Prove it with tests that compare results before and after (exact equality where the computation is deterministic).
- Keep `window.TrussLab`, the file format and the autosaved-session format working unless the milestone changes them on purpose, with migration.
- Leave `fea-core.js` untouched unless the milestone is about the engine.

## 5. Verify

Use `trusslab-testing`. Run `.claude/skills/trusslab-testing/scripts/check.sh` for the syntax checks and all headless suites. For any change that can affect the page, run the browser smoke test in both modes (`index.html?smoke` and `index.html?smoke=selftest`) in a real browser. Report browser verification only if it was actually performed. If no browser is available, list the smoke test as unverified and give the user the manual steps in `docs/development/local-testing.md`.

## 6. Review the diff

Run `git status`, `git diff --stat`, the complete `git diff`, and `git diff --check`. Confirm that only the intended files changed and that nothing outside the plan was edited. New files do not appear in `git diff` until they are staged: read them in full as well.

## 7. Update the documentation

- `README.md` for anything a user sees or runs.
- `CLAUDE.md`: the roadmap status, plus any change to globals, files or the working agreement.
- These skills, when a convention, interface or formula changes.

## 8. Report

Use this structure, with short sections and no padding:

```
## <Step name>: <one-line outcome>
Files changed: each file with +/- line counts, new files marked.
What was done: the approach and the decisions that need review, with reasons.
Test results: a table of check and result. Say where each ran (jsc, Node, stand-in page, or the user's browser).
Not verified: anything that needs a browser, a person, or a decision.
Found, not fixed: problems noticed outside the scope.
What I need from you: approval, a browser run, or a decision.
```

Never report a run as passing if any check failed. Explain every failure, even ones you believe are harmless.

## 9. Commit, only after approval

- Commit only the change the user approved, as one commit, with the message they approved plus the attribution trailer the session requires.
- Check `git log` and `git status` first. The maintainer often commits and pushes approved work themselves (see "Rev 2" and "Rev 3"). If the work is already committed, verify that the commit matches the reviewed diff instead of committing again.
- Commit directly to `main`; that is this repository's workflow.
- Never amend, rebase or force-push commits that are already on `origin`. Do not push unless asked.

## 10. Stop

Do not start the next milestone, even when it is obvious what it is. Say what comes next and wait for the go-ahead.
