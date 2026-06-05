# AutoFrame Agent Notes

## Project Root

- Work in this directory: `/Users/11179013/Documents/Codex/autoframe`.
- This directory is the project root and the required working directory for repository and validation commands.
- Remote repository: `https://github.com/chenshe87-crypto/AutoFrame.git`.
- Published site: `https://chenshe87-crypto.github.io/AutoFrame/`.

## Required Command Directory

- All `git status`, `git diff`, `git commit`, `git push`, tests, and local static server commands must be executed from `/Users/11179013/Documents/Codex/autoframe`.
- Do not run repository operations, tests, or local server startup from any parent directory or old subdirectory path.

## Project Shape

- This is a static frontend app with no build step and no dependency install step.
- Main files:
  - `index.html`: page structure and script/style includes.
  - `styles.css`: layout, controls, responsive UI.
  - `app.js`: state, Canvas rendering, layout algorithms, image loading, drag interactions, PNG export.
- `draw()` is the main render path. It recomputes layouts, paints the canvas, and syncs UI state.
- `state` is the source of truth for layout mode, image list, frame geometry, export scale, background color, and interaction state.

## Default Workflow

- 默认不要自动启动本地服务。
- 默认不要做浏览器自动化验收。
- 小改动只做代码修改和静态检查。
- 只有我明确说“完整验收”时，才启动服务和浏览器测试。
- 本地预览固定使用 `127.0.0.1:8080`。
- 不要反复尝试 `localhost`、`127.0.0.1`、不同端口。
- push 时优先使用 `git push origin main`。
- 每次改动后必须简短说明：
  - 改了哪些文件
  - 实现了什么
  - 我如何手动测试
- 不要因为小改动消耗大量 token 做无意义验证。
- 如果遇到权限、端口、remote、GitHub 登录问题，先报告，不要盲目重试。

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
- 默认只做必要的静态检查；只有用户明确要求“完整验收”时，才做本地服务和浏览器验证。
- Use one commit per completed task.
- Write Git commit messages in Chinese and clearly describe what changed in that version.
- Do not commit or push automatically. Report the local changes and verification result, then wait for the user's confirmation before running `git commit` and `git push`.

## Verification Checklist

- When a full verification is explicitly requested, start a local static server from `/Users/11179013/Documents/Codex/autoframe`:

```bash
python3 -m http.server 8080
```

- Open `http://127.0.0.1:8080`.
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
