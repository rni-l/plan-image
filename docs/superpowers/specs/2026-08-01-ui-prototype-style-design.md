# UI 原型与样式风格设计

## 设计决策总览

| 维度 | 决策 |
|---|---|
| 视觉气质 | 专业效率型（Linear / Craft 风格）|
| Accent 色 | 纯黑/深灰（zinc-900），无彩色主调 |
| 信息密度 | 舒适型（Comfortable）|
| 组件库 | shadcn/ui（Radix UI，React）|
| 导航架构 | 左侧固定 Sidebar（220px）+ 主内容区（flex-1）|
| 整体风格要求 | 高级感、简洁，参考 Linear / Vercel Dashboard / Raycast |

---

## 1. Shell 架构与导航

### 整体骨架

```
┌─────────────────────────────────────────────────────┐
│  Sidebar (220px, fixed) │  Main Content (flex-1)   │
│                          │                           │
│  ● App Name              │  [Breadcrumb]             │
│                          │  [Page Title]             │
│  ▸ 商品库                │                           │
│  ▸ 任务中心              │  页面内容区（可滚动）     │
│                          │                           │
│  ─────────────           │                           │
│  ▸ 设置                  │                           │
└─────────────────────────────────────────────────────┘
```

### Sidebar 细节

- **宽度**：220px，固定，不可折叠（本地桌面工具，无响应式需求）
- **背景**：`zinc-50`（#FAFAFA），与主内容区 `white` 形成微弱分层
- **边界**：右侧 1px `zinc-200` 分割线，无阴影
- **Active 状态**：`bg-zinc-100` + 左侧 2px 黑色 border indicator，`font-medium`
- **图标**：`lucide-react` 16px，颜色跟随文字（`text-zinc-500` 默认，`text-zinc-900` active）
- **任务 badge**：任务中心 nav item 右侧显示进行中任务数，`Badge variant="secondary"`

**Nav 分组：**

```
商品库        ← 主要入口，默认激活
任务中心      ← 右侧 badge 显示进行中数量

────────────

设置          ← 底部低频入口
```

### 路由层级

```
/                        → redirect → /products
/products                → 商品库（列表页）
/products/:id            → 商品工作台（redirect → /products/:id/info）
/products/:id/info       → tab：商品资料
/products/:id/research   → tab：竞品研究
/products/:id/tasks      → tab：成图任务列表
/tasks/:taskId/step/1    → 成图任务向导 Step 1
/tasks/:taskId/step/2    → 成图任务向导 Step 2
/tasks/:taskId/step/3    → 成图任务向导 Step 3
/tasks/:taskId/step/4    → 成图任务向导 Step 4
/task-center             → 任务中心
/settings                → 设置（redirect → /settings/models）
/settings/models         → 模型供应商
/settings/routing        → 场景路由
/settings/presets        → 输出预设
```

### 导航行为

1. 进入商品工作台：面包屑显示 `商品库 / [商品名]`，Sidebar "商品库" 保持高亮
2. Tab 切换不重置滚动位置，状态持久化到 URL
3. 成图任务向导在主内容区展开，Sidebar 始终可见（无全屏遮罩）
4. 任务向导步骤状态持久化，浏览器关闭后可继续
5. 步骤间前进用 `router.push`，后退用 `router.back()`，不丢失表单状态

---

## 2. Design Tokens

### 基础色阶（shadcn zinc 主题）

| Token | Tailwind | Hex | 用途 |
|---|---|---|---|
| `background` | white | `#FFFFFF` | 主内容区背景 |
| `sidebar-bg` | zinc-50 | `#FAFAFA` | Sidebar 背景 |
| `muted` | zinc-100 | `#F4F4F5` | 卡片悬停、选中底色 |
| `border` | zinc-200 | `#E4E4E7` | 输入框边框、主分割线 |
| `card-border` | zinc-100 | `#F4F4F5` | 内容卡片边框（更细腻）|
| `muted-text` | zinc-400 | `#A1A1AA` | placeholder、辅助说明 |
| `secondary-text` | zinc-500 | `#71717A` | 标签、次要信息 |
| `primary-text` | zinc-900 | `#18181B` | 正文、标题 |
| `accent` | zinc-900 | `#18181B` | 按钮、选中态、active indicator |

### 语义状态色

| 状态 | 颜色 | Tailwind class | 用途 |
|---|---|---|---|
| 生成中 | 蓝 | `text-blue-600` | 任务进行中 |
| 等待中 | 灰 | `text-zinc-400` | 队列等待 |
| 已完成 | 绿 | `text-green-600` | 成功完成 |
| 失败 | 红 | `text-red-600` | 生成/调用失败 |
| 等待导出 | 琥珀 | `text-amber-600` | 完成但未导出 |

### 字体系统

中英混排使用系统字体栈，无需引入 web font：

```css
font-family: -apple-system, BlinkMacSystemFont, "Inter", "PingFang SC",
             "Hiragino Sans GB", "Microsoft YaHei", sans-serif;
```

| 层级 | 大小 | Tailwind class | 用途 |
|---|---|---|---|
| 页面标题 | 20px | `text-xl font-semibold` | 商品库、任务中心等页面标题 |
| 区块标题 | 16px | `text-base font-medium` | Tab 内分组标题、设置分区 |
| 正文 | 14px | `text-sm` | 表格行、卡片内容（shadcn 默认）|
| 辅助/标签 | 12px | `text-xs` | 时间戳、状态 badge、字段 label |

### 间距规范

```
页面横向边距：px-8（32px）
卡片内边距：p-6（24px）
列表/卡片间距：gap-4（16px）
区块间距：gap-6（24px）
行高（正文）：leading-6（24px）
```

### shadcn 主题配置

使用 zinc 主题，`globals.css` 关键变量：

```css
:root {
  --radius: 0.5rem;           /* 8px 轻度圆角 */
  --primary: 240 5.9% 10%;    /* zinc-900 */
  --background: 0 0% 100%;    /* white */
  --border: 240 5.9% 90%;     /* zinc-200 */
  --muted: 240 4.8% 95.9%;    /* zinc-100 */
  --muted-foreground: 240 3.8% 46.1%; /* zinc-500 */
}
```

初始化命令：

```bash
npx shadcn@latest init
# 选择：zinc 主题 / CSS variables: yes / React Server Components: 按需
```

---

## 3. 高级感设计规则

### 字体微调

```css
/* 标题收紧字距，增强精致感 */
.page-title   { letter-spacing: -0.02em; font-weight: 600; }
.section-title { letter-spacing: -0.01em; font-weight: 500; }
/* 正文保持 400，避免普遍加粗导致视觉疲劳 */
body { font-weight: 400; }
```

### 卡片与边框层级

| 层级 | 样式 | 用途 |
|---|---|---|
| 内容卡片 | `border border-zinc-100` 无 shadow | 商品卡片、分析卡片 |
| 表单区域 | `border border-zinc-200` | 输入框、Select |
| 浮层/dropdown | `shadow-md border border-zinc-100` | Popover、DropdownMenu |
| 模态框 | `shadow-lg` | Dialog、Sheet |

### 交互状态

- **Hover**：`bg-zinc-50`（极浅，不抢焦点）
- **Active/Selected**：`bg-zinc-100` + 左 2px `bg-zinc-900` indicator
- **Focus ring**：`ring-1 ring-zinc-900 ring-offset-2`（细，黑色，替换默认蓝）
- **Disabled**：`opacity-40 cursor-not-allowed`

### 状态 Badge 格式

使用 dot + text 格式，不用大块填色 pill：

```tsx
<span className="flex items-center gap-1.5 text-sm">
  <span className="h-1.5 w-1.5 rounded-full bg-green-600" />
  <span className="text-zinc-700">已完成</span>
</span>
```

---

## 4. 页面原型

### 4.1 商品库

**布局**：`grid grid-cols-4 gap-4`，商品卡片形式。

**卡片结构**：
- 上方：商品封面图（首张商品图），`aspect-square object-cover`，`rounded-lg border border-zinc-100`
- 下方：商品名（`text-sm font-medium`）/ 任务数 badge / 最后更新时间（`text-xs text-zinc-400`）

**页面操作**：右上角 `+ 新建商品` 按钮（primary）。

**空状态**：居中 icon + `text-zinc-400` 提示文案 + "新建第一个商品" 按钮。

---

### 4.2 商品工作台 — 商品资料

**顶部**：面包屑 `商品库 / [商品名]` + Tab 栏（`商品资料 | 竞品研究 | 成图任务`）。

**内容区两列**：
- 左列（40%）：商品图片上传区，`grid grid-cols-2 gap-2`，`dnd-kit` 拖拽排序，`+ 上传` 卡片
- 右列（60%）：
  - 规格参数：inline-edit 字段（点击字段进入编辑态，`Input` 组件）
  - 核心卖点：`Textarea`，可自由编辑

**保存**：底部 `保存修改` 按钮，仅在有未保存改动时激活。

---

### 4.3 商品工作台 — 竞品研究

**顶部操作栏**：版本选择 `Select`（显示版本号 + 日期 + 素材数）/ `上传素材` 按钮（打开右侧 `Sheet`）/ `生成分析` 按钮。

**主内容两栏**：

- 左区（62%）：逐图分析卡片，`grid grid-cols-2 gap-3`
  - 每张卡片：竞品图缩略图（顶部，`aspect-video`）+ 分析字段（版式/配色/文案/卖点）+ `✎ 修正` 按钮
  - 已修正的卡片：左侧 2px `border-zinc-300` + `已修正` badge

- 右区（38%，`sticky top-6`）：综合报告面板，独立滚动
  - 顶部：版本信息 + `基于修正重新生成` 按钮
  - 内容：行业共性规律 / 差异化机会 / 设计建议，段落 + 引用图片缩略行

**素材管理**：右侧 `Sheet`（`side="right" className="w-[480px]"`），在 Sheet 内管理原始素材，不打断主视图。

---

### 4.4 商品工作台 — 成图任务列表

**顶部**：页面标题 + `+ 新建任务` 按钮（右对齐）。

**任务表格**（`Table`）：

| 列 | 内容 |
|---|---|
| 类型 | 主图套图 / 商品详情页 / 两者 |
| 竞品版本 | v2 · 2025-07-28 |
| 进度 | 3/5 张 |
| 状态 | dot + text badge |
| 操作 | 查看 / 继续（跳转到当前未完成步骤）|

整行可点击，`hover:bg-zinc-50`。

---

### 4.5 成图任务向导 — Step 1：选择配置

**顶部 Stepper**：四步线性步骤条，当前步骤黑色实心，待完成步骤空心 `zinc-300`。

**内容分三块**（单列，`max-w-2xl mx-auto`，居中收窄，增强高级感）：

1. **输出类型**：三个 Radio Card 横排，选中态 `border-2 border-zinc-900`
   - 主图套图 / 商品详情页 / 两者
2. **竞品分析版本**：`Select`，选项显示版本号 + 日期 + 素材数
3. **输出预设**：`Select` + `查看详情` 文字链接

**底部**：右对齐 `下一步 →` 按钮。

---

### 4.6 成图任务向导 — Step 2：设计方向

**加载态**：三列等宽 skeleton 卡片（shimmer 动效）。

**已生成态**：三列候选方向卡片，`grid grid-cols-3 gap-4`。

**方向卡片内容**：
- 方向名称（方向 A / B / C）
- 配色色块行（4个 `w-5 h-5 rounded-sm` 色块）
- 版式描述（`text-sm text-zinc-600`）
- 风格关键词（`text-sm text-zinc-500`）
- 推荐张数
- `选择此方向` 按钮

**选中态**：卡片 `border-2 border-zinc-900`，按钮变 ghost 样式。

**底部**：`← 上一步` ghost 按钮 + `下一步 →` primary 按钮。

---

### 4.7 成图任务向导 — Step 3：编辑方案

**顶部状态栏**：`当前方向：方向 A — 工业可靠感` + `更换方向` 文字链接，下方 1px 分割线。

**内容两列**（`grid grid-cols-[45%_55%] gap-8`）：

**左列 — 文案与配色**：
- 主标题、卖点标语：`Input`
- 版式意图：`Textarea`（3行，可扩展）
- 主色/辅色：Color picker（小色块 + hex 值 + 下拉）

**右列 — 图片清单**：
- 标题行：`图片清单（5张）` + `+ 添加` 按钮
- 拖拽列表（`dnd-kit`），每项：
  - `GripVertical` 拖拽把手
  - 序号 + 图片描述（单行，点击展开详细编辑）
  - 操作：`✎ 编辑` / `✕ 删除`

**底部**：`← 上一步` + `确认方案，开始生成 →`（触发 `Dialog` 二次确认）。

---

### 4.8 成图任务向导 — Step 4：生成与导出

**顶部操作栏**：进度文案 `3 / 5 张完成` + `导出已选` + `全部导出` 按钮（右对齐）。

**图片网格**：`grid grid-cols-3 gap-4`，每个图片项：
- 图片容器：`aspect-square`，`border border-zinc-100 rounded-lg overflow-hidden`
- 状态覆盖层（生成中/失败时显示）
- 图片名称（`text-xs text-zinc-500`）
- 操作行：`微调` / `版本历史` / 选中 checkbox

**图片项状态样式**：
- 生成中：半透明蒙层 + spinner
- 失败：`border-red-200` + `重试` 按钮
- 待生成：`bg-zinc-50` 虚线边框

**微调 Overlay**（`Dialog` 全宽，`max-w-5xl`）：
- 左侧（55%）：图片展示 + 矩形框选工具（canvas overlay）
- 右侧（45%）：自然语言输入 `Textarea` + `生成微调版本` 按钮 + 版本历史缩略图横条

---

### 4.9 任务中心

**过滤 Tab**：`全部 | 进行中 N | 失败 N | 等待导出 N`（`Tabs` 组件，tab 内嵌计数）。

**任务表格**（`Table`）：

| 商品 | 类型 | 进度 | 状态 | 操作 |
|---|---|---|---|---|
| 商品名 | 主图+详情 | 3/5 张 | ● 生成中 | 查看 |
| 商品名 | 主图套图 | 5/5 张 | ● 等待导出 | 导出 |

整行可点击进入任务。

---

### 4.10 设置

**内部二级导航**：左侧 `w-44 bg-zinc-50` 竖向 nav + 右侧内容区。

**模型供应商**：每个供应商一张卡片（`border border-zinc-100`）：
- 供应商名 + 连接状态 dot
- API Key 脱敏显示 + `修改` 按钮
- 底部：`+ 添加供应商` 文字按钮

**场景路由**：二列表格，左列场景名，右列 `Select` 选择模型：

| 场景 | 模型 |
|---|---|
| 竞品分析 | 百炼 · qwen-vl-max ▼ |
| 设计方向生成 | GPT 中转 · gpt-4o ▼ |
| 图片生成 | 火山方舟 · seedream-3 ▼ |
| 图片微调 | 火山方舟 · seededit ▼ |

**输出预设**：可编辑表格行（内联编辑），`+ 新建预设` 按钮。

---

## 5. 组件选型对应表

| UI 元素 | shadcn 组件 | 备注 |
|---|---|---|
| 全局侧边栏 | `SidebarProvider` + `Sidebar` | zinc-50 背景 |
| 工作台 Tab | `Tabs` + `TabsList` + `TabsContent` | — |
| 面包屑 | `Breadcrumb` | — |
| 任务数 badge | `Badge variant="secondary"` | — |
| 数据表格 | `Table` | 整行可点击 |
| 任务类型选择 | Radio Card（自定义，基于 `RadioGroup`）| 选中态 border-2 |
| Select / 下拉 | `Select` | — |
| 输入框 | `Input` / `Textarea` | zinc-200 边框 |
| 颜色选择 | `Popover` + color input | 色块 + hex |
| 拖拽列表 | `dnd-kit`（非 shadcn）| 图片清单、素材排序 |
| 模态确认 | `Dialog` | 方案确认、删除确认 |
| 侧边抽屉 | `Sheet side="right"` | 素材管理 |
| 步骤条 | 自定义 Stepper（基于 `Steps` pattern）| shadcn 无原生 |
| 状态 Badge | 自定义 dot + text（见第3节）| 不用 Badge 组件 |
| 通知/错误提示 | `Sonner`（toast）| 生成失败、保存成功 |
| 空状态 | 自定义（icon + text + CTA）| 商品库空态 |
