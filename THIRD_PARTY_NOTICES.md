# Third-party notices

TrussLab itself is licensed under MIT-0 (see `LICENCE.md`). This repository also contains the third-party material listed below, which keeps its own licence.

## frontend-design (Claude Code skill)

- **Location:** `.claude/skills/frontend-design/` (`SKILL.md` and `LICENSE.txt`)
- **Author:** Anthropic, from the `anthropics/skills` repository
- **Source:** https://github.com/anthropics/skills/tree/main/skills/frontend-design, commit `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` (2026-11-16)
- **Licence:** Apache License 2.0. The full text is in `.claude/skills/frontend-design/LICENSE.txt`.
- **Modifications:** none. The files are vendored verbatim; `UPSTREAM.md` in the same folder records the source, the file hashes and how to update them.
- **Use:** design guidance for Claude Code when working on the user interface. It is not part of the TrussLab application: `index.html` does not load it, and the app does not depend on it.
