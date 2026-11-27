# Local testing on a development machine

Notes for running TrussLab and its tests while developing it. Nothing here is a requirement for people who use TrussLab: the app runs by double-clicking `index.html`, with nothing installed.

The maintainer's machine is a Mac (MacBook Air M2) running Chrome, with the project in `~/Downloads/trusslab` and no Node installed. The notes below come from that setup, but apply to any Mac.

## Opening the app

Double-click `index.html`. If the page shows plain text and unstyled sliders on a white background, the browser loaded `index.html` but not the files beside it (`style.css`, `fea-core.js`, `script.js`).

### macOS protected folders

macOS protects the Downloads, Documents and Desktop folders. When you double-click a file in one of them, the browser gets access to that one file only. It can read the neighbouring files only if it has permission for the whole folder; otherwise Chrome refuses them.

To confirm, open Chrome's console (⌥⌘J). Each refused file shows `Failed to load resource: net::ERR_ACCESS_DENIED`. In Terminal, `ls -l@` shows a `com.apple.macl` attribute on the opened file only: that is how macOS records the single-file permission.

Fix it in either of these ways:

1. System Settings → Privacy & Security → Files & Folders → Google Chrome → turn on the folder (for example "Downloads Folder"). Quit Chrome completely (⌘Q), reopen it, and open `index.html` again.
2. Keep the project in a folder that is not protected, such as `~/Projects/trusslab`. If Claude Code is running in the old folder, restart it from the new one.

## Optional: a local HTTP server

```sh
cd ~/Downloads/trusslab && python3 -m http.server 8000
```

Then open `http://localhost:8000/index.html` (add `?smoke` for the smoke test), and stop the server with Ctrl+C.

This is a testing workaround only, not a way to run TrussLab, and it must never become a runtime requirement:

- Every feature must keep working from `file://`. Do not add code, documentation or tests that need a server.
- A server hides restrictions that apply to `file://` pages (for example on modules and `fetch()`). After any change to how files are loaded, also check the double-click route.
- Browser storage is kept per origin. `http://localhost:8000` has its own saved session, separate from the `file://` one, and neither affects the other.

## Headless checks

```sh
.claude/skills/trusslab-testing/scripts/check.sh
```

This runs from any folder. It uses Node if it is installed; otherwise it uses the JavaScript engine built into macOS, at `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc`.

## Browser smoke test: manual verification

1. Close any other TrussLab tabs. They write the saved session, which the smoke test checks is left untouched.
2. Open `index.html`, add `?smoke` to the end of the address, and press Enter. Keep the tab in front and don't touch it for about 10 seconds: browsers pause the animation frames that the app solves and draws on in background tabs.
3. Expected: the panel in the top-right corner ends with "TrussLab smoke test: PASS". One SKIP is normal, for the side-panel branch that doesn't match the window width. A browser without `DataTransfer` also skips the file-opening checks.
4. Open `index.html?smoke=selftest`. Expected: PASS, with exactly one failure, the deliberate one.
5. Optional: make the window narrower than 920 px and run `?smoke` again, to cover the narrow-window panel branch.
6. Open plain `index.html`. Your previous session should come back as before.

To report the result, send the summary line from each run and any FAIL lines. The browser console shows the same lines, prefixed `[smoke]`.
