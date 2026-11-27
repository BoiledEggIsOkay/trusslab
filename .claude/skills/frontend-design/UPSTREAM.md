# Vendored skill: frontend-design

This folder is a verbatim copy of Anthropic's `frontend-design` skill. `SKILL.md` and `LICENSE.txt` are unmodified; this file is the only addition.

| | |
|---|---|
| Source | https://github.com/anthropics/skills/tree/main/skills/frontend-design |
| Repository | `anthropics/skills`, branch `main` |
| Vendored from commit | `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` (2026-11-16) |
| Retrieved | 2026-11-27 |
| Licence | Apache License 2.0, full text in `LICENSE.txt` |
| Author | Anthropic, `anthropics/skills` repository (the licence file itself has no copyright line) |

Upstream files, with their git blob ids at that commit and their SHA-256:

| File | Bytes | Git blob | SHA-256 |
|---|---|---|---|
| `SKILL.md` | 9390 | `a5333457c414d20d625f307df945842c0952ecc3` | `d91970639e9f5c37682ac7ab60094d35f1c7c1f38d731bd56396563aee10c1d3` |
| `LICENSE.txt` | 10174 | `f433b1a53f5b830a205fd2df78e2b34974656c7b` | `0d542e0c8804e39aa7f37eb00da5a762149dc682d7829451287e11b938e94594` |

The skill is listed in the repository's `THIRD_PARTY_NOTICES.md`. The upstream folder contains no other files. The repository's `THIRD_PARTY_NOTICES.md` does not cover this skill, and there is no `NOTICE` file for it. The upstream README describes its skills as "provided for demonstration and educational purposes only".

## Rules for this folder

- Do not edit `SKILL.md` or `LICENSE.txt`. Apache 2.0 requires a modified file to carry a notice of the change, and edits would make updating harder. Put TrussLab-specific guidance in `../trusslab-ui-design/SKILL.md`, which builds on this skill and takes precedence for TrussLab.
- To update: copy both files from a newer upstream commit, check that the licence is unchanged, and update the table above (commit, date, sizes, hashes). Verify with `shasum -a 256 SKILL.md LICENSE.txt`.
- This is guidance for Claude only. It adds no code, framework, package or runtime dependency to TrussLab.
