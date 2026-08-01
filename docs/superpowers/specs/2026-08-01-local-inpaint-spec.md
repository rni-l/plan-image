# 局部微调（Inpainting）功能设计规范

**日期**：2026-08-01  
**状态**：待实现（第五层第一优先级）  
**关联模块**：TaskWizard Step 4、image_versions、background_jobs

---

## 一、概述

局部微调允许用户对已生成的图片进行局部修改：在图片上涂抹遮罩选出需要修改的区域，输入自然语言指令（如"把左下角背景换成木纹桌面"），提交后由 AI 重绘该区域，生成新版本。

功能在 Step 4（生成与导出）中作为每张已生成图片的后置操作提供，结果以"版本"形式追加到同一图片项，用户可自由切换版本。

---

## 二、现状盘点

代码库已为此功能预留了完整基础设施，**无需改动 DB Schema 或 Gateway**：

| 组件 | 位置 | 状态 |
|------|------|------|
| `imageVersions.generationType = "inpaint"` | `db/schema.ts` | ✅ 已定义 |
| `imageVersions.maskPath / instruction / parentVersionId` | `db/schema.ts` | ✅ 字段已存在 |
| `JobType: "image_edit"` | `db/schema.ts` | ✅ 已声明 |
| `SceneKey: "image_edit"` | `db/schema.ts` | ✅ 已声明 |
| `BailianAdapter.imageEdit()` | `gateway/adapters/bailian.ts` | ✅ 已实现 |
| `GatewayRequest.mask / images` | `gateway/types.ts` | ✅ 类型已定义 |
| `ModelCapability: "image_edit"` | `gateway/types.ts` | ✅ 已声明 |
| `paths.masks` 目录 | `lib/paths.ts` | ✅ 已定义 |

**需要新建**：1 个 job handler、2 个 API 端点、1 个前端 Editor 组件  
**需要修改**：`register.ts`（注册 handler）、`TaskWizard.tsx`（Step 4 增强）

---

## 三、用户操作流程

```
Step 4 生成网格
  └─ 已生成图片 → hover 显示 [✏️ 微调] 按钮
        │
        ▼
  InpaintEditor（全屏 Sheet）打开
  ┌─────────────────────────────────────────────────────────┐
  │  工具栏：[笔刷] [橡皮] [清空]  ●────● 笔刷大小         │
  ├─────────────────────────────────────────────────────────┤
  │  ┌─────────────────────┐  ┌──────────────────────────┐  │
  │  │                     │  │  修改指令                │  │
  │  │  源图 + 红色遮罩     │  │  ┌────────────────────┐  │  │
  │  │  （笔刷涂抹区域）   │  │  │把左下角换成         │  │  │
  │  │                     │  │  │木纹桌面场景         │  │  │
  │  │                     │  │  └────────────────────┘  │  │
  │  └─────────────────────┘  │  [生成微调]  [取消]     │  │
  │                            └──────────────────────────┘  │
  └─────────────────────────────────────────────────────────┘
        │ 提交
        ▼
  POST /tasks/items/:itemId/inpaint
  → 存遮罩文件（.data/assets/masks/）
  → 创建 imageVersion 占位记录
  → 入队 image_edit job
  → Editor 关闭，Step 4 卡片变为"微调中…"
        │ job 完成
        ▼
  imageVersion 填充 filePath，isSelected=true
  Step 4 卡片底部出现版本切换器：v1 [v2]
```

---

## 四、UI 设计

### 4.1 InpaintEditor 组件

**触发**：Step 4 图片卡片上的"微调"按钮（仅在已生成版本存在时显示）  
**容器**：shadcn `<Sheet side="right">` 最大宽度，或覆盖整个内容区

**布局**（两栏）：

```
左栏（Canvas 区）           右栏（操作区）
┌────────────────────┐     ┌────────────────────┐
│  [笔刷] [橡皮] [清空]│     │  修改指令           │
│  ●──● 笔刷大小     │     │  ┌──────────────┐  │
├────────────────────┤     │  │              │  │
│                    │     │  │  Textarea    │  │
│   图片 + 遮罩叠加  │     │  │              │  │
│   （1:1 比例）     │     │  └──────────────┘  │
│                    │     │                    │
│                    │     │  提示文字           │
└────────────────────┘     │  [生成微调] [取消]  │
                            └────────────────────┘
```

**状态机**：

| 状态 | UI 表现 |
|------|---------|
| `idle` | 工具可用，按钮可点击 |
| `submitting` | 按钮 loading，canvas 不可交互 |
| `done` | 自动关闭，toast "微调任务已提交" |

### 4.2 Canvas 遮罩绘制技术方案

使用**两层 canvas 叠加**：

```
position: relative 容器
├── <canvas id="imageCanvas">   底层：drawImage() 渲染源图
└── <canvas id="maskCanvas">    上层：absolute 覆盖，绘制遮罩
```

**遮罩绘制逻辑**：
- 初始状态：maskCanvas 填充黑色（全部保留）
- **笔刷工具**：`globalCompositeOperation = "source-over"`，白色画圆 → 标记编辑区
- **橡皮工具**：`globalCompositeOperation = "source-over"`，黑色画圆 → 撤销选区
- **清空**：`clearRect` + 重新填充黑色

**视觉反馈**（让用户看清选区）：
- maskCanvas 的 CSS `opacity: 0` — 不直接显示黑白遮罩
- 额外覆盖一个半透明 canvas，将白色区域渲染为红色 40% 透明度叠加在图片上

**笔刷连续绘制**（避免快速移动时断点）：
```
onPointerDown → 记录 lastPoint
onPointerMove → 从 lastPoint 到 currentPoint 插值，每隔 2px 画一个圆 → 更新 lastPoint
onPointerUp   → 清除 lastPoint
```

**笔刷大小预设**：16 / 32 / 64 / 128 px（对应"细/中/粗/超粗"）

**导出遮罩**：
```typescript
maskCanvas.toDataURL("image/png")
// 白色 = 编辑区，黑色 = 保留区（inpainting 行业标准格式）
```

### 4.3 Step 4 卡片增强

**微调按钮**（hover 时显示，仅在 `selected !== undefined` 时渲染）：
```
图片区右下角：[✏️] 图标按钮，与现有 [🔍] 放大按钮并列
```

**版本切换器**（`versions.length > 1` 时显示在卡片底部信息行）：
```
标题...     [v1] [v2●] [v3]    ← ● 表示当前选中
```
- 点击任意版本标签 → 调 `PATCH .../select` → 乐观更新本地 state
- 版本标签超过 5 个时折叠为 `< >` 翻页箭头

---

## 五、API 设计

### 5.1 POST `/api/tasks/items/:itemId/inpaint`

**请求体**：
```typescript
{
  parentVersionId: string;  // 要编辑的源版本 id
  maskDataUrl: string;      // "data:image/png;base64,..."（遮罩 PNG）
  instruction: string;      // 自然语言指令，1~500 字
}
```

**服务端逻辑**：
1. 查 `imageVersions` 验证 `parentVersionId.imageItemId === itemId`，否则 404
2. 解码 `maskDataUrl` → 去掉 `data:...;base64,` 前缀 → `Buffer.from(b64, "base64")`
3. 写文件：`path.join(paths.masks, "${maskId}.png")`（原子写入：先写 .tmp 再 rename）
4. 在 `imageVersions` 插入占位记录：
   ```
   generationType: "inpaint"
   parentVersionId: <传入值>
   instruction: <传入值>
   maskPath: "assets/masks/${maskId}.png"
   filePath: ""          ← job 完成后填充
   checksum: ""          ← job 完成后填充
   isSelected: false     ← job 完成后改为 true
   ```
5. `enqueueJob({ type: "image_edit", entityType: "image_item", entityId: itemId, inputSnapshot: { versionId, parentVersionId, instruction } })`
6. 返回 `201 { jobId, versionId }`

> `entityType: "image_item"` 与 `image_generation` 保持一致，Step 4 现有 `pollJobs` 无需修改即可感知 inpaint job 状态变化。

### 5.2 PATCH `/api/tasks/items/:itemId/versions/:versionId/select`

幂等操作，切换选中版本：
1. 验证 `versionId.imageItemId === itemId`
2. `UPDATE image_versions SET is_selected=0 WHERE image_item_id = itemId`
3. `UPDATE image_versions SET is_selected=1 WHERE id = versionId`
4. 返回 `204 No Content`

---

## 六、Job Handler: `image-edit`

**文件**：`packages/server/src/jobs/handlers/image-edit.ts`

**inputSnapshot 结构**：
```typescript
interface ImageEditInput {
  versionId: string;        // 目标占位 version（handler 负责填充）
  parentVersionId: string;  // 源图 version
  instruction: string;
}
```

**执行步骤**：

```
1. 查 imageVersions 取 parentVersion（需要 filePath）
2. 查 imageVersions 取 newVersion（需要 maskPath、imageItemId）
3. 查 imageItems 取 outputPresetSnapshot → 解析宽高
4. 读 parentVersion.filePath → Buffer → base64（源图）
5. 读 newVersion.maskPath → Buffer → base64（遮罩）
6. gatewayCall("image_edit", {
     scene: "image_edit",
     prompt: instruction,
     images: [sourceB64],
     mask: maskB64,
     parameters: { task_type: "image_edit", size: `${W}x${H}`, n: 1 },
   })
7. 保存结果图 → saveImageAsset(buffer, uuid, "generated")
8. UPDATE image_versions SET is_selected=false WHERE image_item_id = itemId
9. UPDATE image_versions SET
     file_path = saved.relativePath,
     checksum = saved.checksum,
     job_id = jobId,
     is_selected = true
   WHERE id = versionId
10. UPDATE image_items SET updated_at = now WHERE id = itemId
```

---

## 七、数据流总结

```
用户涂抹遮罩 + 输入指令
  │
  ▼ POST /tasks/items/:itemId/inpaint
  ├─ 写文件  .data/assets/masks/{maskId}.png
  ├─ INSERT image_versions (filePath="", generationType="inpaint")
  └─ INSERT background_jobs (type="image_edit", entityType="image_item")
        │
        ▼ Worker 拾取 job
        ├─ 读源图 → base64
        ├─ 读遮罩 → base64
        ├─ gatewayCall → 返回 image base64
        ├─ 写文件  .data/assets/generated/{resultId}.jpg
        ├─ UPDATE image_versions (所有版本 isSelected=false)
        └─ UPDATE image_versions (新版本 filePath, checksum, isSelected=true)
              │
              ▼ Step 4 pollJobs（3.5s 间隔）感知 job succeeded
              └─ loadVersions → 新版本出现在卡片，版本切换器显示
```

---

## 八、文件清单

### 新建

| 文件 | 说明 |
|------|------|
| `packages/server/src/jobs/handlers/image-edit.ts` | image_edit job handler |
| `packages/web/src/pages/tasks/InpaintEditor.tsx` | 遮罩绘制 + 提交 Sheet 组件 |

### 修改

| 文件 | 改动说明 |
|------|---------|
| `packages/server/src/jobs/register.ts` | 注册 `image_edit` → `handleImageEdit` |
| `packages/server/src/routes/tasks.ts` | 新增 `/inpaint` 和 `/versions/:versionId/select` 端点 |
| `packages/web/src/pages/tasks/TaskWizard.tsx` | Step4：微调按钮 + 版本切换器 + 触发 InpaintEditor |

### 不需要改动

- `packages/server/src/db/schema.ts` — schema 已完备
- `packages/server/src/gateway/` — 适配器已实现
- `packages/web/src/lib/api.ts` — 通用 fetch wrapper 已可用

---

## 九、实现顺序

```
① image-edit.ts（handler）
② register.ts（注册）
③ tasks.ts（API 端点）
④ InpaintEditor.tsx（前端组件）
⑤ TaskWizard.tsx Step 4（集成入口）
```

后端先行，可用 curl 单测 API；前端组件独立开发，最后集成到 Step 4。

---

## 十、边界情况与约束

| 场景 | 处理方式 |
|------|---------|
| 遮罩为全黑（未涂抹任何区域） | 前端提交前校验，提示用户"请先涂抹需要修改的区域" |
| 指令为空 | 前端校验，required |
| 遮罩 dataUrl 超过 5MB | 前端压缩到 512×512 再导出（遮罩不需要高分辨率） |
| inpaint job 失败 | Step 4 卡片显示"微调失败"，占位 version 保留但不展示；可再次点击微调重试 |
| 源版本在 job 执行期间被删除 | handler 查不到 parentVersion → 抛出错误 → job 标记 failed |
| 并发多次微调同一张图 | 每次都创建新的占位 version + 新 job，互不干扰；完成后各自追加到版本列表 |

