import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  Download,
  FileSearch,
  Package,
  Settings2,
  Sparkles,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  buildGuideLinks,
  selectGuideExamples,
  type GuideExamples,
  type GuideProduct,
  type GuideTask,
} from "./guide-content";

const TASK_STAGES: Record<number, string> = {
  1: "选择配置",
  2: "生成方向",
  3: "编辑方案",
  4: "生成与导出",
};

export function GuidePage() {
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

  const links = buildGuideLinks(examples);
  const taskStage = examples.task
    ? TASK_STAGES[examples.task.currentStep] ?? `步骤 ${examples.task.currentStep}`
    : "尚未创建任务";
  const resultState = !examples.task
    ? "等待创建任务"
    : examples.task.currentStep >= 4
      ? "已进入生成与导出"
      : "等待完成任务";

  return (
    <div className="mx-auto max-w-6xl px-6 py-8 lg:px-8">
      <header className="mb-8">
        <p className="text-sm font-medium text-zinc-500">工作流程</p>
        <h1 className="page-title mt-1 text-2xl text-zinc-900">使用指南</h1>
        <p className="mt-2 text-sm leading-6 text-zinc-500">
          从建立商品资料开始，依次完成竞品研究、成图任务和导出。
        </p>
        <div className="mt-4 inline-flex items-center gap-2 rounded-lg bg-zinc-100 px-3 py-2 text-sm text-zinc-700">
          <Sparkles size={15} className="text-zinc-500" />
          <span>先完成一轮成图</span>
        </div>
      </header>

      <section aria-label="成图工作流程" className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <WorkflowCard
          number="01"
          title="建立商品资料"
          description="录入商品基础信息，上传商品图、规格资料与参考素材。"
          icon={Package}
          to={links.product}
          cta="前往商品资料"
          loading={loading}
          rows={[
            { label: "商品名称", value: examples.product?.name ?? "示例商品" },
            { label: "资料状态", value: examples.product ? "已建立" : "待建立", tone: examples.product ? "ready" : "pending" },
          ]}
        />
        <WorkflowCard
          number="02"
          title="完成竞品研究"
          description="上传竞品素材，整理参考方向，生成可用的分析结论。"
          icon={FileSearch}
          to={links.research}
          cta="开始竞品研究"
          loading={loading}
          rows={[
            { label: "上传竞品素材", value: "待上传", tone: "pending" },
            { label: "竞品分析", value: "待开始", tone: "pending" },
          ]}
        />
        <WorkflowCard
          number="03"
          title="创建并确认成图任务"
          description="选择输出类型，确认创作方向与生成方案。"
          icon={Sparkles}
          to={links.task}
          cta="创建成图任务"
          loading={loading}
          rows={[
            { label: "关联商品", value: examples.product?.name ?? "待选择" },
            { label: "任务阶段", value: taskStage, tone: examples.task ? "active" : "pending" },
          ]}
        />
        <WorkflowCard
          number="04"
          title="生成、微调与导出"
          description="生成结果后继续微调，并按需导出成图。"
          icon={Download}
          to={links.export}
          cta="查看生成结果"
          loading={loading}
          rows={[
            { label: "当前结果", value: resultState, tone: examples.task?.currentStep === 4 ? "active" : "pending" },
            { label: "导出格式", value: "主图 / 详情页" },
          ]}
        />
      </section>

      <section aria-labelledby="advanced-configuration" className="mt-10 border-t border-zinc-100 pt-8">
        <div className="mb-4">
          <h2 id="advanced-configuration" className="text-base font-semibold text-zinc-900">进阶配置</h2>
          <p className="mt-1 text-sm text-zinc-500">按团队的工作方式配置模型、输出和日常管理能力。</p>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AdvancedCard icon={Settings2} title="模型配置" description="配置模型供应商和可用的生成模型。">
            <GuideLink to="/settings/models" ariaLabel="前往模型配置">管理模型</GuideLink>
          </AdvancedCard>
          <AdvancedCard icon={Settings2} title="输出预设" description="设置常用的尺寸、质量和输出规格。">
            <GuideLink to="/settings/presets" ariaLabel="前往输出预设">管理预设</GuideLink>
          </AdvancedCard>
          <AdvancedCard icon={FileSearch} title="Prompt 管理" description="维护可复用的提示词模板和创作方向。">
            <GuideLink to="/prompts" ariaLabel="前往 Prompt 管理">管理 Prompt</GuideLink>
          </AdvancedCard>
          <AdvancedCard icon={Settings2} title="用量与日志" description="查看调用用量、计费信息和系统日志。">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <GuideLink to="/billing" ariaLabel="前往用量与计费">查看用量</GuideLink>
              <GuideLink to="/logs" ariaLabel="前往日志">查看日志</GuideLink>
            </div>
          </AdvancedCard>
        </div>
      </section>
    </div>
  );
}

type WindowRow = {
  label: string;
  value: string;
  tone?: "pending" | "active" | "ready";
};

function WorkflowCard({
  number,
  title,
  description,
  icon: Icon,
  to,
  cta,
  rows,
  loading,
}: {
  number: string;
  title: string;
  description: string;
  icon: LucideIcon;
  to: string;
  cta: string;
  rows: WindowRow[];
  loading: boolean;
}) {
  return (
    <article className="flex flex-col rounded-xl border border-zinc-100 bg-white p-5 shadow-sm">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
          <Icon size={17} />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium tracking-wide text-zinc-400">{number}</p>
          <h2 className="mt-0.5 text-base font-semibold text-zinc-900">{title}</h2>
          <p className="mt-1 text-sm leading-5 text-zinc-500">{description}</p>
        </div>
      </div>
      <MiniWindow rows={rows} loading={loading} />
      <GuideLink to={to} ariaLabel={`${cta}：${title}`} className="mt-4">{cta}</GuideLink>
    </article>
  );
}

function MiniWindow({ rows, loading }: { rows: WindowRow[]; loading: boolean }) {
  return (
    <div className={`mt-5 overflow-hidden rounded-lg border border-zinc-100 bg-zinc-50 ${loading ? "animate-pulse" : ""}`}>
      <div className="flex items-center gap-1.5 border-b border-zinc-100 bg-white px-3 py-2">
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
        <span className="h-1.5 w-1.5 rounded-full bg-zinc-300" />
      </div>
      <div className="space-y-2 p-3">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3 rounded-md bg-white px-2.5 py-2">
            <span className="text-xs text-zinc-500">{row.label}</span>
            {row.tone ? (
              <StateChip tone={row.tone}>{row.value}</StateChip>
            ) : (
              <span className="truncate text-xs font-medium text-zinc-700">{row.value}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function StateChip({ children, tone }: { children: string; tone: NonNullable<WindowRow["tone"]> }) {
  const styles = {
    pending: "bg-zinc-100 text-zinc-500",
    active: "bg-blue-50 text-blue-700",
    ready: "bg-green-50 text-green-700",
  };
  return <span className={`shrink-0 rounded-md px-2 py-0.5 text-xs font-medium ${styles[tone]}`}>{children}</span>;
}

function AdvancedCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <article className="rounded-xl border border-zinc-100 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-zinc-100 text-zinc-600">
          <Icon size={16} />
        </div>
        <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
      </div>
      <p className="mt-3 text-sm leading-5 text-zinc-500">{description}</p>
      <div className="mt-4">{children}</div>
    </article>
  );
}

function GuideLink({
  to,
  ariaLabel,
  className = "",
  children,
}: {
  to: string;
  ariaLabel: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      aria-label={ariaLabel}
      className={`inline-flex items-center gap-1 text-sm font-medium text-zinc-900 underline-offset-4 transition-colors hover:text-zinc-600 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-900 focus-visible:ring-offset-2 ${className}`}
    >
      {children}
      <ArrowRight size={14} aria-hidden="true" />
    </Link>
  );
}
