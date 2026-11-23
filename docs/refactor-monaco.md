# 技术方案：编辑器换成 Monaco，精简侧栏

> 状态：已实现并通过类型、单元测试、lint、构建与 Chromium 浏览器验收 · 日期：2026-11-17 · 建议分支：`refactor/monaco`

## 1. 背景与目标

现在输入区用的是 CodeMirror 6 加 `@codemirror/merge`。为了让它满足需求，写了不少适配代码：

| 现有适配                                   | 位置                                                                    | 换成 Monaco 后                          |
| ------------------------------------------ | ----------------------------------------------------------------------- | --------------------------------------- |
| merge 补丁 `preserveChanges`               | `patches/@codemirror__merge@6.12.2.patch`                               | 删除                                    |
| 自定义行 / 单词 / 字符 diff 算法、坐标映射 | `src/lib/diff.ts`（175 行）                                             | 删除，改用 Monaco 内置算法              |
| 左右同步滚动                               | `src/lib/scrolling.ts`                                                  | 删除，Monaco 内置                       |
| 页面级滚动、侧栏吸附                       | `src/lib/page-layout.ts`、`Workbench.vue` 中的 capture/restore 滚动逻辑 | 删除，改为视口满高布局                  |
| 当前差异块装饰、折叠可访问性补丁           | `src/lib/editor.ts`                                                     | 只保留一个很小的装饰工具                |
| 合并视图单独建一个 EditorView              | `Workbench.vue` `buildUnified()`                                        | 删除，同一个实例切换 `renderSideBySide` |

**目标**

1. 输入区内核换成 Monaco Editor 的 DiffEditor，样式跟现有设计变量保持一致。
2. 侧栏精简：分组整理，把不常用的项收起来，去掉“对比方式”和“修改行数”。
3. 删掉过时代码，让文档和测试跟新实现一致。

**不做**：语法高亮、语言检测、正文持久化、服务端处理（跟现有需求一致）。

## 2. 已确认的决策

| #   | 决策           | 结论                                                                                                                                                  |
| --- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | 编辑器         | Monaco Editor `IStandaloneDiffEditor`，从 npm 安装、自托管，不走 CDN                                                                                  |
| D2  | 滚动模型       | 工作区高度等于视口（`100dvh`），由 Monaco 在内部滚动，页面本身不滚动                                                                                  |
| D3  | 左右 / 合并    | 只建一个 DiffEditor，用 `renderSideBySide` 切换；`originalEditable: true`；合并视图里修改后的文本仍可编辑，删除行只读；不再有“只读条”和“返回编辑”按钮 |
| D4  | 对比方式       | 去掉“行 / 单词 / 字符”，使用 Monaco `diffAlgorithm: 'advanced'`（行级差异加行内字符级高亮）                                                           |
| D5  | 侧栏内容       | 常用和核心项一直显示；“自动折行、折叠相同内容”收进可折叠的“显示”分组；语言和主题默认跟随系统，放到底部做成图标按钮                                    |
| D6  | 统计           | 只显示 `+N −M`（新增行 / 删除行），不再显示“修改”                                                                                                     |
| D7  | 编辑器外观     | 纯文本（`plaintext`），关掉 minimap，保留 overview ruler、行号和 +/− 指示，关掉补全、悬停等代码智能功能                                               |
| D8  | 窄屏           | 保留抽屉；用 `useInlineViewWhenSpaceIsLimited` 自动切到合并视图；手机端只承诺基本可用                                                                 |
| D9  | 合并视图的输入 | 合并视图用一行标题，放两组按钮：原文 [打开文件] [粘贴] [复制]，修改后 [打开文件] [复制]。原文只能通过文件或粘贴导入                                   |

## 3. 依赖变更

```diff
 dependencies:
-  "@codemirror/commands", "@codemirror/merge", "@codemirror/state", "@codemirror/view"
+  "monaco-editor": "^0.55"   # 实施时锁定当时最新的 0.5x 稳定版
   "overlayscrollbars"          # 只剩手机抽屉在用；如果抽屉改用原生滚动，可以一起删掉
```

- 删掉 `patches/` 目录，以及 `pnpm-workspace.yaml` 里的 `patchedDependencies`。
- 删掉 stylelint 里给 CodeMirror 类名开的白名单，换成 Monaco 需要的白名单（如果 `global.css` 里要覆盖 `.monaco-*`）。

### 3.1 按需加载（控制体积）

**不要** `import * as monaco from 'monaco-editor'`，那样会把所有语言都打包进来，旧的 `dist/` 就是这么出问题的。只引入编辑器核心和通用 worker：

```ts
// src/lib/monaco.ts
import * as monaco from 'monaco-editor/esm/vs/editor/editor.api';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
export { monaco };
```

- diff 计算在 `editor.worker` 里进行，不会卡主线程。
- `Workbench.vue` 本来就是 `client:only="vue"`。建议在 `onMounted` 里用 `await import('../lib/monaco')` 动态加载，让侧栏先显示出来，编辑区显示骨架屏。
- 体积目标：editor 相关 JS（gzip 后）≤ 1 MB，验收时用 `pnpm build` 的输出确认。

## 4. 模块结构

```
src/
  components/
    Workbench.vue        # 状态与布局（大幅瘦身）
    DiffEditor.vue       # 新增：封装 Monaco 生命周期、事件、命令
    Sidebar.vue          # 新增：从 Workbench 拆出侧栏
    PaneHeader.vue       # 新增：左右 / 合并两种标题
    SwitchControl.vue    # 保留
    CustomSelect.vue     # 删除（对比方式去掉以后没人用了）
  lib/
    monaco.ts            # 新增：按需加载与 worker
    monaco-theme.ts      # 新增：根据 CSS 变量生成主题
    diff-stats.ts        # 新增：根据 ILineChange[] 计算统计、定位当前差异（纯函数，方便测试）
    i18n.ts              # 更新文案
    responsive-chrome.ts # 检查后保留或合并
    diff.ts / editor.ts / scrolling.ts / page-layout.ts   # 删除
```

## 5. DiffEditor 封装

### 5.1 创建参数

```ts
const editor = monaco.editor.createDiffEditor(host, {
  // 布局与视图
  automaticLayout: true,
  renderSideBySide: layout === 'split',
  useInlineViewWhenSpaceIsLimited: true,
  renderSideBySideInlineBreakpoint: 820, // 跟抽屉断点保持一致
  originalEditable: true,
  // 差异
  diffAlgorithm: 'advanced',
  ignoreTrimWhitespace: ignoreWhitespace,
  renderIndicators: true, // +/− 指示
  renderMarginRevertIcon: false,
  renderOverviewRuler: true,
  hideUnchangedRegions: {
    enabled: collapse,
    contextLineCount: 3,
    minimumLineCount: 4,
    revealLineCount: 20,
  },
  // 外观
  wordWrap: wrap ? 'on' : 'off',
  diffWordWrap: wrap ? 'on' : 'off',
  minimap: { enabled: false },
  fontFamily: "'JetBrains Mono', 'PingFang SC', 'Microsoft YaHei', monospace",
  fontSize: 14,
  lineHeight: 22,
  scrollBeyondLastLine: false,
  // 关掉代码智能
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: 'off',
  hover: { enabled: false },
  parameterHints: { enabled: false },
  codeLens: false,
  occurrencesHighlight: 'off',
  selectionHighlight: false,
  links: false,
  contextmenu: false,
  unicodeHighlight: { ambiguousCharacters: false },
});
editor.setModel({
  original: monaco.editor.createModel('', 'plaintext'),
  modified: monaco.editor.createModel('', 'plaintext'),
});
```

各项设置变化时调用 `editor.updateOptions({...})` 就行，**不要重建实例**，这样撤销历史、光标和滚动位置都能保留下来。

### 5.2 组件接口（DiffEditor.vue）

| 方向   | 名称                                                                | 说明                                                       |
| ------ | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| props  | `layout` `wrap` `collapse` `ignoreWhitespace` `theme` `placeholder` | 变化时调用 `updateOptions` / `setTheme`                    |
| emit   | `change(side, text)`                                                | 来自两个 model 的 `onDidChangeContent`                     |
| emit   | `diff(lineChanges)`                                                 | 来自 `onDidUpdateDiff`，传 `getLineChanges() ?? []`        |
| emit   | `cursor(side, lineNumber)`                                          | 用来同步“当前第几处”                                       |
| expose | `setText(side, text)`                                               | 用 `pushEditOperations` 整体替换，**能被 Ctrl+Z 撤销**     |
| expose | `goTo(index)`                                                       | 根据 lineChanges[index] 用 `revealLineInCenter` 并设置光标 |
| expose | `focus(side)`                                                       |                                                            |

### 5.3 差异导航与当前块

- Monaco 有 `goToDiff('next'|'previous')`，但它不提供“当前是第几处”，所以统一由我们自己管：
  - `current` 存在 Workbench 里；上一处 / 下一处按 `(current ± 1) mod count` 计算，再调用 `goTo(index)`。
  - 光标移动时，用 `diff-stats.ts#findChunkIndex(lineChanges, side, lineNumber)` 反查当前块。
- 当前块高亮：用 `createDecorationsCollection` 给当前块的行加 `isWholeLine` 加 `linesDecorationsClassName: 'diff-active-chunk'`，左侧显示 3px 的 accent 竖条，跟现有视觉一致。
- 快捷键：保留全局的 `Alt+↑/↓`、`F7 / Shift+F7`。Monaco 自己的 F7 会打开 Accessible Diff Viewer 导航，需要在编辑器里用 `addCommand` 覆盖成我们的 `jump()`，保证计数同步。

### 5.4 统计（diff-stats.ts）

```ts
export function lineStats(changes: ILineChange[]) {
  let added = 0,
    deleted = 0;
  for (const c of changes) {
    if (c.originalEndLineNumber > 0)
      deleted += c.originalEndLineNumber - c.originalStartLineNumber + 1;
    if (c.modifiedEndLineNumber > 0)
      added += c.modifiedEndLineNumber - c.modifiedStartLineNumber + 1;
  }
  return { added, deleted };
}
```

- `ignoreTrimWhitespace` 生效时，只有空白不同的行 Monaco 不会报告，统计自然也会把它们排除。
- `count = changes.length`（差异块数量），跟现在的“N 处差异”含义一样。
- 在等 `onDidUpdateDiff` 返回的这段时间显示 `busy`（“正在比较”）：文本一变就置为 true，diff 更新回来后再置为 false。

### 5.5 主题（monaco-theme.ts）

`global.css` 里的 CSS 变量仍然是唯一的颜色来源。主题切换时，读取 `getComputedStyle(document.documentElement)`，规范成 `#rrggbb`（把 `#fff` 这种短写法展开），然后 `defineTheme` 加 `setTheme`：

| Monaco 颜色键                                                                  | CSS 变量                        |
| ------------------------------------------------------------------------------ | ------------------------------- |
| `editor.background`、`editorGutter.background`                                 | `--panel`                       |
| `editor.foreground`                                                            | `--text`                        |
| `editorLineNumber.foreground` / `editorLineNumber.activeForeground`            | `--muted` / `--text`            |
| `editorCursor.foreground`                                                      | `--accent`                      |
| `editor.selectionBackground`                                                   | `--selection`                   |
| `editor.lineHighlightBackground`                                               | `--active-line`                 |
| `diffEditor.insertedLineBackground` / `insertedTextBackground`                 | `--add-bg` / `--add-mark`       |
| `diffEditor.removedLineBackground` / `removedTextBackground`                   | `--remove-bg` / `--remove-mark` |
| `diffEditorGutter.insertedLineBackground` / `removedLineBackground`            | `--add-bg` / `--remove-bg`      |
| `diffEditorOverview.insertedForeground` / `removedForeground`                  | `--add` / `--remove`            |
| `diffEditor.unchangedRegionBackground`、`diffEditor.unchangedRegionForeground` | `--surface` / `--muted`         |
| `editorWidget.background`、`editorWidget.border`                               | `--panel` / `--border`          |
| `scrollbarSlider.*`                                                            | 根据 `--muted` 加透明度         |

- `base` 分别用 `vs` / `vs-dark`；`rules: []`（纯文本不需要 token 着色）。
- 字体：等 `document.fonts.ready` 之后调用 `monaco.editor.remeasureFonts()`，避免 JetBrains Mono 晚加载导致光标错位。
- 主题切换时一并把 `<meta name="theme-color">` 改掉。

### 5.6 空态占位、拖拽、粘贴

- 占位文字：给两侧的子编辑器分别设置 `placeholder`（Monaco 0.5x 编辑器参数），文案沿用 `emptyHint`。实施时要确认 DiffEditor 有没有把这个参数传给子编辑器，没有的话就对 `getOriginalEditor()` / `getModifiedEditor()` 分别 `updateOptions`。
- 文件拖入：保留现在在容器上用 capture 阶段处理 `dragover/drop` 的做法（按鼠标在左半还是右半决定放到哪一侧），并且 `stopPropagation`，防止 Monaco 自己的 drop-into-editor 把文件路径插进正文。合并视图下：按左右半区分别放入原文 / 修改后，覆盖层文案不变。
- “粘贴到原文”：`navigator.clipboard.readText()` 拿到内容后调用 `setText('a', text)`；读取失败时显示新提示 `pasteError`。

## 6. 布局与侧栏

### 6.1 页面布局

```
┌────────────┬──────────────────────────────────────────┐
│  侧栏       │  标题栏（左右：两列；合并：一行两组按钮）     │ 44px
│  ~220px    ├──────────────────────────────────────────┤
│            │                                          │
│            │  Monaco DiffEditor（flex: 1，内部滚动）     │
│            │                                          │
└────────────┴──────────────────────────────────────────┘
height: 100dvh; overflow: hidden
```

### 6.2 侧栏结构（从上到下）

```
Diff.                                   ← 品牌
[ 左右 | 合并 ]                          ← 分段控件（取代 Switch）
┌──────────────────────────┐
│ 3 / 8 处差异        ↑  ↓ │            ← 差异摘要卡（核心）
│ +12  −5                  │            ← 统计（新增绿 / 删除红，等宽数字）
└──────────────────────────┘
☐ 忽略行首尾空白                         ← 常用，会改变结果
▸ 显示                                   ← 可折叠分组（<details>），默认收起
   ☐ 自动折行
   ☐ 折叠相同内容
（弹性空白）
[ 🗑 清空全部 / ↶ 撤销清空 ]               ← 核心操作，固定在底部
中/EN   ☀/☾                             ← 底部图标按钮（tooltip 写明作用）
```

- 去掉每一行开关前面的装饰图标，只有分段控件和底部按钮保留图标。
- 空态时差异摘要卡显示状态文案（等待输入 / 内容一致 / 当前比较规则下无差异），不显示统计。
- “显示”分组是展开还是收起，写入偏好保存。

### 6.3 默认值与偏好

| 偏好             | 默认                                                | 是否保存                                   |
| ---------------- | --------------------------------------------------- | ------------------------------------------ |
| locale           | `navigator.language` 以 `zh` 开头就用中文，否则英文 | 用户主动切换后保存                         |
| theme            | `prefers-color-scheme`                              | 用户主动切换后保存；没保存过时跟随系统变化 |
| layout           | `split`                                             | 保存                                       |
| wrap / collapse  | `true` / `true`                                     | 保存                                       |
| ignoreWhitespace | `false`                                             | 不保存（跟现在一样）                       |
| displayGroupOpen | `false`                                             | 保存                                       |

- `index.astro` 里的内联防闪烁脚本要同步改：没有保存过主题时，用 `matchMedia('(prefers-color-scheme: dark)')` 判断。
- `localStorage` 的键名还用 `diff.preferences`，读取时忽略已经废弃的 `comparisonMethod`。

### 6.4 标题栏

- **左右视图**：每侧一个标题，跟现在一样（名称、行数、文件名、[打开文件] [复制]），两列宽度跟 Monaco 左右两栏对齐。
  Monaco 两栏默认对半分，同时关掉拖动分隔条（`enableSplitViewResizing: false`），这样标题就不用跟着分隔条走。
- **合并视图**：一行标题，`原文 [打开] [粘贴] [复制] · 修改后 [打开] [复制]`，窄屏下只显示图标。
- 合并视图是由窄屏自动切换过去的（D8）时，要在 `onDidChangeModel` 或尺寸变化时判断实际的渲染模式，标题样式跟着切换。实施时可以监听宿主宽度是否 ≤ 断点来推断。

## 7. 文案（i18n）变更

- 删除：`comparisonMethod` `byLine` `byWord` `byCharacter` `changedLines` `readonly` `edit` `unified` 中“只读”相关的组合用法。
- 新增：`display`（显示 / Display）、`paste`（粘贴 / Paste）、`pasteError`、`inline`（合并 / Inline）。
- Monaco 自己的界面文字（折叠区的“展开 N 行”、右键菜单等）默认是英文。
  方案：**接受英文**，或者在加载 Monaco 前按 locale 引入中文语言包，但这种方式切换语言要刷新页面。建议先接受英文，因为相关文字很少（见第 10 节待定项）。

## 8. 删除清单

- 文件：`src/lib/diff.ts`、`src/lib/editor.ts`、`src/lib/scrolling.ts`、`src/lib/page-layout.ts`、`src/components/CustomSelect.vue`、`patches/`；本地旧的 `dist/` 可以直接删掉（已在 `.gitignore` 里，里面是之前带全部语言包的构建产物）。
- `global.css`：CodeMirror 相关样式、页面吸顶和侧栏吸附相关样式、只读条样式。
- `Workbench.vue`：`capturePageScroll` / `restorePageScroll` / `buildUnified` / `slots` / `Compartment` 等全部 CM 逻辑。

## 9. 测试与验收

### 9.1 自动化测试（`tests/*.test.mjs`）

Monaco 的 diff 跑在浏览器 worker 里，Node 测试里不直接调用它。改成测**纯函数**：

| 用例             | 内容                                                   |
| ---------------- | ------------------------------------------------------ |
| `lineStats`      | 纯新增、纯删除、修改（删 1 增 1）、混合、空数组        |
| `findChunkIndex` | 光标在块内、块外、删除型块（modifiedEnd=0）的边界      |
| 偏好解析         | 旧数据里有 `comparisonMethod` 时忽略；没保存时跟随系统 |
| 主题颜色规范化   | `#fff` → `#ffffff`，非法值的回退                       |

### 9.2 浏览器验收（手工或 Playwright）

| 编号 | 场景                        | 期望                                                      |
| ---- | --------------------------- | --------------------------------------------------------- |
| A01  | 两侧文本相同                | 显示“内容一致”，0 处差异                                  |
| A03  | 中文长句只改两个字          | 只高亮改动的字符，不是整行（用 Monaco advanced 算法复核） |
| A09  | 开启忽略行首尾空白          | 只有缩进不同的行不算差异                                  |
| A10  | CRLF 和 LF                  | 不算差异（model 会统一行尾）                              |
| A14  | JSON 字段顺序不同           | 按原文本比较，有差异                                      |
| N1   | 左右 ↔ 合并切换             | 不重建实例，撤销历史和光标都保留                          |
| N2   | 上一处 / 下一处、F7、Alt+↑↓ | 计数同步，目标居中，当前块有竖条                          |
| N3   | 清空后撤销清空；清空后输入  | 能恢复两侧内容和文件名；输入后撤销入口消失                |
| N4   | 拖入文件到左 / 右半区       | 替换对应一侧，不插入路径                                  |
| N5   | 合并视图里“粘贴到原文”      | 原文被替换，diff 更新                                     |
| N6   | 明暗 × 中英                 | 颜色跟 CSS 变量一致，没有闪烁                             |
| N7   | 宽度 ≤ 820px                | 抽屉可用，自动变成合并视图，标题切成合并样式              |
| N8   | 1 万行文本                  | 输入不卡，diff 在 1 秒内更新                              |
| N9   | `pnpm build`                | 不包含语言包 chunk；editor 相关 JS（gzip）≤ 1 MB          |

### 9.3 文档

- `docs/requirements.md`：去掉对比方式和修改行统计；合并视图改为“可编辑修改后文本”；滚动改为编辑器内部滚动。
- `docs/ui-ux-design.md`：补一节“2026-11 Monaco 重构与侧栏精简”，更新布局图和截图。
- `README.md`：更新“库与适配边界”“已实现功能”“验证记录”，删掉补丁说明。

## 10. 风险与待定项

| 项                       | 风险 / 问题                                  | 处理建议                                               |
| ------------------------ | -------------------------------------------- | ------------------------------------------------------ |
| Monaco 界面文字          | 跟页面语言不一致，运行时切换不了             | 先接受英文；有需要再做“切换语言时刷新页面”加语言包     |
| 窄屏实际渲染模式         | Monaco 没有直接暴露“当前是不是 inline”的事件 | 用宿主宽度和断点推断；实施时查一下有没有可用的内部事件 |
| 手机输入                 | IME、选区不稳定                              | 已定为尽力而为（D8），不作为阻塞项                     |
| `placeholder` 参数       | 不同版本支持程度不同                         | 锁定的版本要包含它；不支持就用 overlay 自己实现        |
| 当前块与 Monaco 内置导航 | 两套状态可能不一致                           | 统一走我们自己的 `jump()`，覆盖 F7                     |
| 体积                     | worker 加核心约 2–3 MB（未压缩）             | 动态 import 加骨架屏；按 N9 验收                       |

## 11. 实施顺序（建议）

1. 建分支，装 `monaco-editor`，加 `lib/monaco.ts`，用一个最小页面跑通 DiffEditor 和 worker。
2. 写 `DiffEditor.vue`（创建参数、事件、`setText`、`goTo`、当前块装饰）和 `monaco-theme.ts`。
3. Workbench 改成视口满高布局，接上 DiffEditor，删掉 CM 代码和滚动逻辑。
4. 拆出 `Sidebar.vue` 并按第 6.2 节重做；拆出 `PaneHeader.vue`（左右 / 合并两种）。
5. 文件拖入、粘贴到原文、清空和撤销、快捷键。
6. 偏好与系统默认值，`index.astro` 防闪烁脚本。
7. 删除清单、依赖清理、lint 规则调整。
8. 测试（9.1），浏览器验收（9.2），更新文档和截图（9.3）。

## 12. 实施记录（2026-11-17）

- 锁定 `monaco-editor` 0.57.0。此版本通过 package exports 导出 `monaco-editor/editor/editor.api.js` 和 `monaco-editor/editor/editor.worker.js?worker`，因此使用这些路径替代第 3.1 节旧路径；同样只加载编辑器核心。
- 单独引入图标、占位提示和剪贴板功能；`hover.enabled` 使用 0.57 的 `'off'`，`wordBasedSuggestions` 对子编辑器设置。
- 抽屉使用原生滚动，一并删除 OverlayScrollbars。旧 `unified` 偏好迁移为 `inline`。
- `pnpm check`、5 项纯函数测试、lint 和静态构建通过；Chromium 覆盖 A01/A03/A09/A10/A14、N1–N8 的主要交互。1 万行、单处修改样本约 245 ms。
- 核心与 worker 的 gzip 合计 803,817 B（约 785 KiB），无语言包 chunk，满足 N9 体积目标。
- 最新截图见 README 与 UI / UX 设计说明；Monaco 内部提示保留英文。

## 13. 侧栏交互调整（2026-11-17）

- 移除“显示”折叠分组及 `displayGroupOpen` 偏好，忽略行首尾空白、自动折行、折叠相同内容三个开关常驻。
- 差异状态区移至三个开关下方，移除独立背景与边框，取消内边距，与上方开关区左右对齐，两区间距为 8px；统计出现或消失不移动上方控件。
- 导航按钮统一为 28×28 圆角方形，悬停使用淡蓝背景。
- 修复通用 hover 规则覆盖布局按钮选中背景的问题，选中态在鼠标悬停时保持蓝色。
- Chromium 验证浅色 / 深色选中态、状态变化时控件与底部位置稳定、窄屏抽屉；类型、5 项单元测试、格式检查和构建通过。
