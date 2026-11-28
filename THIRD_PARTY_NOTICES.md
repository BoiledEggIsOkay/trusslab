# Third-party notices

TrussLab itself is licensed under MIT-0 (see `LICENCE.md`). This repository also contains the third-party material listed below, which keeps its own licence.

## frontend-design (Claude Code skill)

- **Location:** `.claude/skills/frontend-design/` (`SKILL.md` and `LICENSE.txt`)
- **Author:** Anthropic, from the `anthropics/skills` repository
- **Source:** https://github.com/anthropics/skills/tree/main/skills/frontend-design, commit `e4bb5d960d87126ff3b3a8af1a104b7db67560ba` (2026-11-16)
- **Licence:** Apache License 2.0. The full text is in `.claude/skills/frontend-design/LICENSE.txt`.
- **Modifications:** none. The files are vendored verbatim; `UPSTREAM.md` in the same folder records the source, the file hashes and how to update them.
- **Use:** design guidance for Claude Code when working on the user interface. It is not part of the TrussLab application: `index.html` does not load it, and the app does not depend on it.

## IBM Plex Sans and IBM Plex Mono (fonts)

- **Location:** `fonts/` (13 `.woff2` files and `OFL.txt`)
- **Author:** IBM Corp. Copyright © 2017 IBM Corp. with Reserved Font Name "Plex".
- **Source:** https://github.com/IBM/plex, release assets `ibm-plex-sans.zip` of `@ibm/plex-sans@1.3.6` and `ibm-plex-mono.zip` of `@ibm/plex-mono@2.5.0`, the files under `fonts/split/woff2/`.
- **Licence:** SIL Open Font License, Version 1.1. The full text, with IBM's copyright notice, is in `fonts/OFL.txt`. The OFL covers the font files only; it does not apply to the rest of TrussLab.
- **Modifications:** none. Only the subsets TrussLab needs are included, exactly as IBM publishes them: Sans in weights 400, 500 and 600 (Latin-1, Pi and Greek subsets), Mono in weights 400 and 500 (Latin-1 and Pi subsets; Plex Mono has no Greek subset). The fonts keep their names, so the Reserved Font Name is respected.
- **Use:** the interface typeface, loaded by `style.css` from relative paths with `@font-face`, so it works from a double-clicked `file://` page with no network. System fonts are the fallback.
- **SHA-256 of the files:**

```
41201b658a328b9d00368215c2f1102770f80b15952ab82631e4006255e6365d  IBMPlexMono-Medium-Latin1.woff2
92bd18415e8c43a2569f615e4e84a94b1b1c4e0377ba9d8f4d894bbf6ffcc39d  IBMPlexMono-Medium-Pi.woff2
e8993d946649b9d01abb1ed06d574b19d8ea3e66b5c3948602db335c44c18e56  IBMPlexMono-Regular-Latin1.woff2
b8002770aa636f544ba43e124da6a227301769754f295eae26e16475b469c767  IBMPlexMono-Regular-Pi.woff2
03bd731f7365faeb9003fe325c3ba2e9d38bfb4d457158f8a7e3dab92a3d3599  IBMPlexSans-Medium-Greek.woff2
668a0d9eabbfac0925f431988f56222b8b989ad66a0a78e91bc5889f73fe274a  IBMPlexSans-Medium-Latin1.woff2
61c22214682a80c430458cda6a1b7f8c32fd46bb2bc03b405fb50fa6fdd58a2c  IBMPlexSans-Medium-Pi.woff2
4bf076fec0d3d5aa2d9fdf3dbaa6db22058628faac52e841f66635a36da67c21  IBMPlexSans-Regular-Greek.woff2
bdb53f2af84b15e0a742428f5e199dacc3e6fd60776f0aebd9f700e2c97c960f  IBMPlexSans-Regular-Latin1.woff2
3b52c2fd8715cb8526823a8d425ebc369b716c8232f5092cf38dce305b73676a  IBMPlexSans-Regular-Pi.woff2
6c5134b0d324480d285af343edccdc013be0662ee8e0bb43c698a87e17defa1f  IBMPlexSans-SemiBold-Greek.woff2
8251b7fc61b580c2f52550fa69b3c49fb94fc333815ad301ca6b1f6d15420f85  IBMPlexSans-SemiBold-Latin1.woff2
1beaaee0bfa91cf0d77e4f0b43f9bf12a1364f7cc3af05fa14f857297f2552e6  IBMPlexSans-SemiBold-Pi.woff2
```
