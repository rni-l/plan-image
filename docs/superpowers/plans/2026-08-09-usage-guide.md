# 使用指南页面 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Add a data-aware /guide page that explains the complete image-production workflow and links users into every relevant product area.

**Architecture:** Keep record selection and CTA route construction in a small pure guide-content module. GuidePage loads the existing product/task APIs in parallel and displays current values inside screenshot-like miniature UI cards with a complete static fallback. Router and sidebar receive one route/link only.

**Tech Stack:** React 19, React Router 7, TypeScript, Tailwind CSS 4, lucide-react, Node test runner.

## Global Constraints

- Reuse only existing /products and /tasks?page=1 APIs; do not change server routes or database schema.
- Show existing local product/task values when available but retain usable guide copy and links for empty or failed responses.
- Keep all copy in Simplified Chinese, match the current zinc UI, and add no dependencies.
- Do not introduce onboarding progress, popups, mutations, or external documentation.

---

### Task 1: Create the guide data boundary

**Files:**

- Create: packages/web/src/pages/guide/guide-content.ts
- Create: packages/web/test/guide-content.test.ts

**Interfaces:**

- Consumes product rows with id, name, and updatedAt; task rows with id, productId, productName, currentStep, and updatedAt.
- Produces selectGuideExamples(products, tasks): GuideExamples, buildGuideLinks(examples), and GUIDE_ROUTE.

- [ ] **Step 1: Write a failing test**

Create packages/web/test/guide-content.test.ts:

    import assert from "node:assert/strict";
    import test from "node:test";
    import { GUIDE_ROUTE, buildGuideLinks, selectGuideExamples } from "../src/pages/guide/guide-content.js";

    test("selects the latest product and matching task", () => {
      const value = selectGuideExamples(
        [{ id: "old", name: "旧商品", updatedAt: 10 }, { id: "new", name: "演示保温杯", updatedAt: 20 }],
        [{ id: "t-old", productId: "old", productName: "旧商品", currentStep: 4, updatedAt: 30 }, { id: "t-new", productId: "new", productName: "演示保温杯", currentStep: 3, updatedAt: 40 }],
      );
      assert.deepEqual(value, { product: { id: "new", name: "演示保温杯" }, task: { id: "t-new", productId: "new", currentStep: 3 } });
    });

    test("provides safe routes when no examples exist", () => {
      assert.deepEqual(buildGuideLinks({ product: null, task: null }), { product: "/products", research: "/products", task: "/products", export: "/task-center" });
      assert.equal(GUIDE_ROUTE, "/guide");
    });

- [ ] **Step 2: Confirm the test fails**

Run: node --import tsx --test packages/web/test/guide-content.test.ts

Expected: FAIL because the guide module has not been created.

- [ ] **Step 3: Implement the selector and link builder**

Create packages/web/src/pages/guide/guide-content.ts:

    export interface GuideProduct { id: string; name: string; updatedAt: number }
    export interface GuideTask { id: string; productId: string; productName: string; currentStep: number; updatedAt: number }
    export interface GuideExamples {
      product: Pick<GuideProduct, "id" | "name"> | null;
      task: Pick<GuideTask, "id" | "productId" | "currentStep"> | null;
    }

    export const GUIDE_ROUTE = "/guide";

    export function selectGuideExamples(products: GuideProduct[], tasks: GuideTask[]): GuideExamples {
      const product = [...products].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      const matchedTask = product ? tasks.filter((item) => item.productId === product.id).sort((a, b) => b.updatedAt - a.updatedAt)[0] : undefined;
      const task = matchedTask ?? [...tasks].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      return {
        product: product ? { id: product.id, name: product.name } : null,
        task: task ? { id: task.id, productId: task.productId, currentStep: task.currentStep } : null,
      };
    }

    export function buildGuideLinks(examples: GuideExamples) {
      return {
        product: examples.product ? "/products/" + examples.product.id + "/info" : "/products",
        research: examples.product ? "/products/" + examples.product.id + "/research" : "/products",
        task: examples.product ? "/products/" + examples.product.id + "/tasks" : "/products",
        export: examples.task ? "/tasks/" + examples.task.id + "/step/" + examples.task.currentStep : "/task-center",
      };
    }

- [ ] **Step 4: Run the tests and commit**

Run: node --import tsx --test packages/web/test/guide-content.test.ts

Expected: PASS with two subtests.

    git add packages/web/src/pages/guide/guide-content.ts packages/web/test/guide-content.test.ts
    git commit -m "feat: add guide example selector"

### Task 2: Build the usage-guide UI

**Files:**

- Create: packages/web/src/pages/guide/GuidePage.tsx
- Modify: packages/web/src/pages/guide/guide-content.ts

**Interfaces:**

- Consumes api.get products, api.get tasks?page=1, selectGuideExamples, and buildGuideLinks.
- Produces GuidePage, with safe primary and advanced help destinations.

- [ ] **Step 1: Write the data-loading boundary**

At the top of GuidePage, use this state and effect:

    const [examples, setExamples] = useState<GuideExamples>({ product: null, task: null });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      Promise.allSettled([
        api.get<GuideProduct[]>("/products"),
        api.get<{ data: GuideTask[] }>("/tasks?page=1"),
      ]).then(([products, tasks]) => {
        setExamples(selectGuideExamples(
          products.status === "fulfilled" ? products.value : [],
          tasks.status === "fulfilled" ? tasks.value.data : [],
        ));
      }).finally(() => setLoading(false));
    }, []);

- [ ] **Step 2: Implement screenshot-style workflow cards**

Render title 使用指南, subtitle, and zinc-100 callout 先完成一轮成图. Render four cards using grid-cols-1 lg:grid-cols-2, ordered as follows:

1. 01 建立商品资料: show examples.product name or 示例商品; link using links.product.
2. 02 完成竞品研究: show uploaded-material/analysis status; link using links.research.
3. 03 创建并确认成图任务: show real task stage when present; link using links.task.
4. 04 生成、微调与导出: show current result state; link using links.export.

Each card contains a Lucide icon, text matching the approved design, a Link CTA with aria-label, and a MiniWindow with titlebar, neutral rows, and state chips. MiniWindow is presentational only. Apply animate-pulse only to MiniWindow while loading; never hide copy or disable a link.

- [ ] **Step 3: Implement advanced configuration**

Below a border, render 进阶配置 in another responsive two-column card grid:

- 模型配置 links to /settings/models.
- 输出预设 links to /settings/presets.
- Prompt 管理 links to /prompts.
- 用量与日志 contains separate links to /billing and /logs.

Use existing zinc card/text styles and visible focusable links for every destination.

- [ ] **Step 4: Build and commit**

Run: pnpm --filter web build

Expected: TypeScript compilation and Vite build both succeed.

    git add packages/web/src/pages/guide/GuidePage.tsx
    git commit -m "feat: add data-aware usage guide page"

### Task 3: Register navigation and verify end-to-end

**Files:**

- Modify: packages/web/src/router.tsx
- Modify: packages/web/src/components/layout/Sidebar.tsx

**Interfaces:**

- Consumes GuidePage from Task 2.
- Produces /guide inside AppShell and an active 使用指南 sidebar entry.

- [ ] **Step 1: Add the application route**

Import GuidePage in packages/web/src/router.tsx and add:

    { path: "guide", element: <GuidePage /> },

- [ ] **Step 2: Add sidebar navigation**

In packages/web/src/components/layout/Sidebar.tsx, import CircleHelp from lucide-react and append after Prompt 管理:

    { to: "/guide", label: "使用指南", icon: CircleHelp },

Existing isActive handles selection.

- [ ] **Step 3: Run all checks**

Run: node --import tsx --test packages/web/test/*.test.ts && pnpm --filter web build && git diff --check

Expected: guide and existing task-wizard tests pass, Vite builds successfully, and no whitespace errors are reported.

- [ ] **Step 4: Inspect live local data**

Start the project using its normal development command and visit /guide. Confirm: sidebar is active; existing product/task values appear in miniature cards; each link reaches an existing page; both grids become one column at narrow width.

- [ ] **Step 5: Commit navigation integration**

    git add packages/web/src/router.tsx packages/web/src/components/layout/Sidebar.tsx
    git commit -m "feat: add usage guide navigation"
