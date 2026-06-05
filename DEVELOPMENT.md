# AutoFrame 开发与发布约定

本文档把当前项目的迭代方式固定下来，方便后续开发、验证和发布保持一致。

## 项目位置

- 本地仓库：`/Users/11179013/Documents/Codex/autoframe`
- GitHub 仓库：`https://github.com/chenshe87-crypto/AutoFrame.git`
- GitHub Pages：`https://chenshe87-crypto.github.io/AutoFrame/`

注意：后续所有仓库操作、测试和本地验证都以 `/Users/11179013/Documents/Codex/autoframe` 作为唯一项目根目录。

## 命令执行目录规则

以下命令必须在 `/Users/11179013/Documents/Codex/autoframe` 执行：

- `git status`
- `git diff`
- `git commit`
- `git push`
- 测试命令
- 本地静态服务启动命令，例如 `python3 -m http.server 8080`

不要在父目录或旧的子目录路径中执行 Git 操作、测试或本地服务启动。

## 技术结构

AutoFrame 是纯前端静态网页，不依赖构建工具。

- `index.html`：页面结构，引用样式和脚本。
- `styles.css`：界面样式、三栏布局、移动端响应式。
- `app.js`：核心状态、Canvas 绘制、排版算法、图片读取、拖拽交互和 PNG 导出。

核心运行方式是：用户操作更新 `state`，再通过 `draw()` 重新计算布局、绘制画布并同步界面状态。

## 界面规范

- 品牌和高亮状态统一使用 Orange Coral 渐变，主要变量在 `styles.css` 的 `--accent-gradient`、`--accent`、`--accent-warm`、`--accent-deep` 中维护。
- 普通按钮保持浅色背景，只有选中态、悬停强调态和画布操作线使用品牌强调色。
- 滑块需要使用自定义浅色轨道，不使用浏览器默认的黑色进度条。
- 修改 `app.js` 后，需要同步更新 `index.html` 中的 `app.js?v=...` 版本参数，避免浏览器缓存旧脚本。

## 迭代流程

1. 在 `/Users/11179013/Documents/Codex/autoframe` 中确认当前 Git 状态。
2. 阅读相关实现，按现有代码风格做最小必要修改。
3. 修改后先做本地验证，并记录验证结果。
4. 汇报本地改动内容和测试结果。
5. 等用户确认后，再执行一次任务一个 commit，并 push 到 `main`。

默认不自动提交或推送。只有用户明确确认发布时，才更新 GitHub。

提交到 GitHub 时，commit message 必须使用中文，并清楚说明这个版本更新了什么。示例：

```text
完善开发发布流程文档
修复完整显示模式下的图片空白计算
新增导出清晰度选项
```

## 本地验证

从 `/Users/11179013/Documents/Codex/autoframe` 启动静态服务：

```bash
python3 -m http.server 8080
```

然后访问：

```text
http://localhost:8080
```

每次涉及功能或界面变化时，至少检查：

- 示例图片可以正常添加。
- 拼贴、网格、行列三种布局可以切换。
- 裁切和完整两种图片适配方式可以切换。
- 默认灰白区域背景、默认 `0` 间距、默认 `0` 圆角正确显示。
- 间距、圆角、背景色、比例和随机板式仍然生效，滑块轨道颜色和品牌色协调。
- 画布区域可以拖动和缩放。
- 图片可以排序、反转和清空。
- PNG 可以按标准、高清、超清导出。

## 发布检查

- 如果修改了 `app.js`，并且线上可能受缓存影响，应同步更新 `index.html` 中 `app.js?v=...` 的版本参数。
- 推送前确认 `git status` 只包含本次任务相关文件。
- 推送后检查 `https://chenshe87-crypto.github.io/AutoFrame/` 是否刷新；GitHub Pages 和浏览器缓存可能需要等待一小段时间。
