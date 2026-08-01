import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Pencil, Check, X, Trash2 } from "lucide-react";
import { toast } from "sonner";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BillingSummary {
  totalCalls: number;
  succeededCalls: number;
  failedCalls: number;
  totalPromptTokens: number;
  totalCompTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

interface ModelRow {
  provider: string;
  model: string;
  totalCalls: number;
  succeededCalls: number;
  failedCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  avgDurationMs: number | null;
  pricePerMInput: number | null;
  pricePerMOutput: number | null;
  estimatedCostUsd: number | null;
}

interface PricingRow {
  id: string;
  provider: string;
  modelId: string;
  pricePerMInputTokens: number;
  pricePerMOutputTokens: number;
  isImageModel: boolean;
  pricePerImage: number;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  bailian:    "百炼",
  volcengine: "火山方舟",
  gpt_proxy:  "GPT中转",
};

function fmtNum(n: number | null | undefined, decimals = 0) {
  if (n == null) return "—";
  return n.toLocaleString("zh-CN", { maximumFractionDigits: decimals });
}

function fmtUsd(n: number | null | undefined) {
  if (n == null) return "—";
  if (n < 0.001) return "< $0.001";
  return `$${n.toFixed(4)}`;
}

function SummaryCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-zinc-400">{sub}</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pricing editor row
// ---------------------------------------------------------------------------

function PricingEditorRow({
  row,
  onSave,
  onDelete,
}: {
  row: PricingRow;
  onSave: (r: PricingRow) => void;
  onDelete: (r: PricingRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [input, setInput] = useState(row.pricePerMInputTokens.toString());
  const [output, setOutput] = useState(row.pricePerMOutputTokens.toString());

  const save = async () => {
    await onSave({ ...row, pricePerMInputTokens: Number(input), pricePerMOutputTokens: Number(output) });
    setEditing(false);
  };

  return (
    <tr className="border-b last:border-0">
      <td className="px-3 py-2 text-xs">{PROVIDER_LABELS[row.provider] ?? row.provider}</td>
      <td className="px-3 py-2 font-mono text-xs">{row.modelId}</td>
      <td className="px-3 py-2 text-xs text-right">
        {editing ? (
          <Input value={input} onChange={e => setInput(e.target.value)} className="h-6 w-24 text-xs text-right" />
        ) : (
          `$${row.pricePerMInputTokens}`
        )}
      </td>
      <td className="px-3 py-2 text-xs text-right">
        {editing ? (
          <Input value={output} onChange={e => setOutput(e.target.value)} className="h-6 w-24 text-xs text-right" />
        ) : (
          `$${row.pricePerMOutputTokens}`
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {editing ? (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => void save()}>
              <Check size={12} className="text-emerald-600" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(false)}>
              <X size={12} className="text-zinc-400" />
            </Button>
          </div>
        ) : (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(true)}>
              <Pencil size={12} className="text-zinc-400" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(row)}>
              <Trash2 size={12} className="text-zinc-400" />
            </Button>
          </div>
        )}
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// New pricing row form
// ---------------------------------------------------------------------------

function AddPricingForm({ onAdd }: { onAdd: () => void }) {
  const [provider, setProvider] = useState("");
  const [modelId, setModelId]   = useState("");
  const [inputP, setInputP]     = useState("0");
  const [outputP, setOutputP]   = useState("0");
  const [saving, setSaving]     = useState(false);

  const submit = async () => {
    if (!provider.trim() || !modelId.trim()) {
      toast.error("供应商和模型ID不能为空");
      return;
    }
    setSaving(true);
    try {
      await api.put(`/billing/pricing/${encodeURIComponent(provider)}/${encodeURIComponent(modelId)}`, {
        pricePerMInputTokens:  Number(inputP),
        pricePerMOutputTokens: Number(outputP),
      });
      setProvider(""); setModelId(""); setInputP("0"); setOutputP("0");
      onAdd();
    } catch {
      toast.error("保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <tr className="border-t bg-zinc-50/50">
      <td className="px-3 py-2">
        <Input value={provider} onChange={e => setProvider(e.target.value)}
          placeholder="bailian / volcengine / gpt_proxy" className="h-6 text-xs" />
      </td>
      <td className="px-3 py-2">
        <Input value={modelId} onChange={e => setModelId(e.target.value)}
          placeholder="模型ID" className="h-6 font-mono text-xs" />
      </td>
      <td className="px-3 py-2">
        <Input value={inputP} onChange={e => setInputP(e.target.value)}
          className="h-6 w-24 text-xs text-right ml-auto" />
      </td>
      <td className="px-3 py-2">
        <Input value={outputP} onChange={e => setOutputP(e.target.value)}
          className="h-6 w-24 text-xs text-right ml-auto" />
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" className="h-6 text-xs px-3" disabled={saving} onClick={() => void submit()}>
          添加
        </Button>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BillingPage() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [models,  setModels]  = useState<ModelRow[]>([]);
  const [pricing, setPricing] = useState<PricingRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m, p] = await Promise.all([
        api.get<BillingSummary>("/billing/summary"),
        api.get<{ data: ModelRow[] }>("/billing/by-model"),
        api.get<{ data: PricingRow[] }>("/billing/pricing"),
      ]);
      setSummary(s);
      setModels(m.data);
      setPricing(p.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleSavePricing = async (row: PricingRow) => {
    try {
      await api.put(`/billing/pricing/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.modelId)}`, {
        pricePerMInputTokens:  row.pricePerMInputTokens,
        pricePerMOutputTokens: row.pricePerMOutputTokens,
        isImageModel:  row.isImageModel,
        pricePerImage: row.pricePerImage,
      });
      toast.success("价格已更新");
      await load();
    } catch {
      toast.error("保存失败");
    }
  };

  const handleDeletePricing = async (row: PricingRow) => {
    try {
      await api.delete(`/billing/pricing/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.modelId)}`);
      toast.success("已删除");
      await load();
    } catch {
      toast.error("删除失败");
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-base font-semibold text-zinc-900">用量与计费</h1>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 text-xs" onClick={() => void load()}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          刷新
        </Button>
      </div>

      <div className="flex flex-col gap-6 p-6 overflow-y-auto">
        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <SummaryCard
            label="总调用次数"
            value={fmtNum(summary?.totalCalls)}
            sub={`成功 ${fmtNum(summary?.succeededCalls)} / 失败 ${fmtNum(summary?.failedCalls)}`}
          />
          <SummaryCard
            label="总Token用量"
            value={fmtNum(summary?.totalTokens)}
            sub={`输入 ${fmtNum(summary?.totalPromptTokens)} / 输出 ${fmtNum(summary?.totalCompTokens)}`}
          />
          <SummaryCard
            label="预估费用 (USD)"
            value={fmtUsd(summary?.estimatedCostUsd)}
            sub="根据下方价格配置计算"
          />
          <SummaryCard
            label="平均输出Token"
            value={
              summary && summary.succeededCalls > 0
                ? fmtNum(Math.round(summary.totalCompTokens / summary.succeededCalls))
                : "—"
            }
            sub="每次成功调用"
          />
        </div>

        {/* By-model breakdown */}
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-700">按模型汇总</h2>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-3 py-2 text-left font-medium">供应商</th>
                  <th className="px-3 py-2 text-left font-medium">模型</th>
                  <th className="px-3 py-2 text-right font-medium">调用次数</th>
                  <th className="px-3 py-2 text-right font-medium">输入Token</th>
                  <th className="px-3 py-2 text-right font-medium">输出Token</th>
                  <th className="px-3 py-2 text-right font-medium">平均耗时</th>
                  <th className="px-3 py-2 text-right font-medium">预估费用</th>
                </tr>
              </thead>
              <tbody>
                {models.length === 0 && (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-xs text-zinc-400">暂无数据</td></tr>
                )}
                {models.map((r) => (
                  <tr key={`${r.provider}:${r.model}`} className="border-b last:border-0 hover:bg-zinc-50/50">
                    <td className="px-3 py-2 text-xs">{PROVIDER_LABELS[r.provider] ?? r.provider}</td>
                    <td className="px-3 py-2 font-mono text-xs text-zinc-700">{r.model}</td>
                    <td className="px-3 py-2 text-right text-xs">
                      <span>{fmtNum(r.totalCalls)}</span>
                      {r.failedCalls > 0 && (
                        <Badge variant="failed" className="ml-1.5 text-xs px-1 py-0">
                          {r.failedCalls}失败
                        </Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-600">{fmtNum(r.promptTokens)}</td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-600">{fmtNum(r.completionTokens)}</td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-500">
                      {r.avgDurationMs ? `${(r.avgDurationMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-zinc-800">
                      {r.pricePerMInput == null ? (
                        <span className="text-zinc-400 text-xs">未配置价格</span>
                      ) : (
                        fmtUsd(r.estimatedCostUsd)
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Pricing config */}
        <section>
          <h2 className="mb-3 text-sm font-medium text-zinc-700">价格配置</h2>
          <p className="mb-3 text-xs text-zinc-500">
            按模型配置每百万 Token 的价格（USD），用于估算费用。修改后立即生效于所有历史数据汇总。
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-3 py-2 text-left font-medium">供应商</th>
                  <th className="px-3 py-2 text-left font-medium">模型ID</th>
                  <th className="px-3 py-2 text-right font-medium">输入 $/1M Token</th>
                  <th className="px-3 py-2 text-right font-medium">输出 $/1M Token</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {pricing.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-zinc-400">暂无价格配置</td></tr>
                )}
                {pricing.map((r) => (
                  <PricingEditorRow
                    key={r.id}
                    row={r}
                    onSave={handleSavePricing}
                    onDelete={handleDeletePricing}
                  />
                ))}
                <AddPricingForm onAdd={() => void load()} />
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
