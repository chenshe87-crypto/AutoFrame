# AutoFrame Agent Notes

## Project Root

- Work in this directory: `/Users/11179013/Documents/Codex/autoframe/image-layout-web`.
- The parent folder is not the Git repository. This directory contains `.git`.
- Remote repository: `https://github.com/chenshe87-crypto/AutoFrame.git`.
- Published site: `https://chenshe87-crypto.github.io/AutoFrame/`.

## Project Shape

- This is a static frontend app with no build step and no dependency install step.
- Main files:
  - `index.html`: page structure and script/style includes.
  - `styles.css`: layout, controls, responsive UI.
  - `app.js`: state, Canvas rendering, layout algorithms, image loading, drag interactions, PNG export.
- `draw()` is the main render path. It recomputes layouts, paints the canvas, and syncs UI state.
- `state` is the source of truth for layout mode, image list, frame geometry, export scale, background color, and interaction state.

## Interface Conventions

- Keep the visual accent system on the Orange Coral gradient defined in `styles.css`.
- Use the gradient for selected/high-emphasis states and canvas control lines; keep ordinary action buttons light.
- Range inputs should use the custom light track styles. Do not rely on browser-default black range tracks.
- Default frame background is gray-white, with gap and corner radius starting at `0`.

## Development Workflow

- Read the current implementation before editing.
- Keep changes scoped to the requested task and follow the existing plain HTML/CSS/JavaScript style.
- Do not introduce a framework, package manager, bundler, or build pipeline unless the user explicitly asks or the feature clearly requires it.
- If browser caching could hide a shipped JavaScript change, update the `app.js?v=...` query string in `index.html`.
- After local edits, validate the app before asking to publish.
- Use one commit per completed task.
- Write Git commit messages in Chinese and clearly describe what changed in that version.
- Do not commit or push automatically. Report the local changes and verification result, then wait for the user's confirmation before running `git commit` and `git push`.

## Verification Checklist

- Start a local static server from this directory when browser validation is needed:

```bash
python3 -m http.server 8080
```

- Open `http://localhost:8080`.
- Check the main happy path:
  - Add demo images.
  - Switch layout modes: mosaic, grid, rows.
  - Switch image fit modes: cover and contain.
  - Adjust gap, radius, background color, ratio, and random layout.
  - Confirm range tracks use the Orange Coral/light gray treatment.
  - Drag and resize the frame.
  - Reorder, reverse, and clear images.
  - Export PNG at standard, high, and ultra quality.
- After a confirmed push, check the GitHub Pages URL and allow time for Pages/cache refresh if needed.
