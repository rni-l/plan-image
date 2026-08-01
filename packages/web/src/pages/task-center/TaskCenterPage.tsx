import { NavLink } from "react-router-dom";

const FILTER_TABS = ["全部", "进行中", "失败", "等待导出"] as const;

export function TaskCenterPage() {
  return (
    <div className="px-8 py-8">
      <h1 className="page-title mb-6 text-xl">任务中心</h1>

      {/* Filter tabs */}
      <div className="mb-4 flex gap-1 border-b border-zinc-200">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab}
            className="border-b-2 border-transparent px-3 pb-2 text-sm text-zinc-500 transition-colors
                       first:border-zinc-900 first:font-medium first:text-zinc-900 hover:text-zinc-700"
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Placeholder table */}
      <p className="text-sm text-zinc-400">暂无任务</p>
    </div>
  );
}
