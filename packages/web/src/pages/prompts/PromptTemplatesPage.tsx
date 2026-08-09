import { PromptTemplatesSection } from "@/pages/settings/SettingsPage";

/** Primary Prompt workspace: page header stays fixed while the editor manages its own overflow. */
export function PromptTemplatesPage() {
  return (
    <main className="flex h-full min-h-0 flex-col overflow-hidden px-6 py-5">
      <header className="mb-4 shrink-0">
        <h1 className="text-lg font-semibold text-zinc-900">Prompt 管理</h1>
        <p className="mt-1 text-sm text-zinc-500">管理模板、变量与最终渲染预览。</p>
      </header>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        <PromptTemplatesSection />
      </div>
    </main>
  );
}
