# Diff Workbench

基于 Astro、Vue 和 Monaco DiffEditor 的本地文本对比工作台。正文仅在浏览器内存中处理，不上传或自动保存。

## 开发

需要 Node.js 22.13+ 和 pnpm 10 或 11。

```sh
pnpm install
pnpm dev
pnpm check
pnpm lint
pnpm test
pnpm build
```

## 功能

- 双侧编辑与可编辑的内联视图；窄屏自动切换内联。
- 行内差异、overview ruler、差异导航和新增 / 修改 / 删除行统计。
- 自动折行、折叠相同内容、忽略行首尾空白；CRLF 和 LF 统一比较。
- 打开或拖入 UTF-8 文件、复制整侧、清空并撤销清空。
- 查找替换、多光标、列选择及 Monaco 原生编辑命令。
- 默认纯文本，可手动选择语法着色；中英文外壳、明暗主题和显示设置记忆。

F7 / Shift+F7 或 Alt+F5 / Shift+Alt+F5 跳转差异；Alt+上 / 下移动行。正文不保存在本地存储中，刷新会清空。

Monaco 和 worker 由本站提供，不依赖 CDN。Monaco 0.57.0 的安装包目前缺少可直接用于 ESM 的官方简体中文语言包，因此编辑器内部菜单仍为英文；外层界面支持中英文切换。移动端只保证基本查看和操作，不保证完整编辑体验。

需求与设计见 [需求说明](docs/requirements.md)、[设计说明](docs/ui-ux-design.md)，迁移方案和验证情况见 [迁移计划](docs/monaco-migration-plan.md)。
