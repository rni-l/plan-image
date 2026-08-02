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
  estimatedCostCny: number;
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
  outputImageCount: number;
  inputImageCount: number;
  avgDurationMs: number | null;
  isImageModel: boolean | null;
  estimatedCost: number | null;
  currency: string | null;
}

interface PricingRow {
  id: string;
  provider: string;
  modelId: string;
  currency: string;
  isImageModel: boolean;
  // Text-model fields
  pricePerMInputTokens: number;
  pricePerMCachedInputTokens: number;
  pricePerMOutputTokens: number;
  // Image-model fields
  pricePerImage: number;
  pricePerInputImage: number;
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

function fmtCost(cost: number | null, currency: string | null) {
  if (cost == null || currency == null) return "—";
  const sym = currency === "CNY" ? "¥" : "$";
  if (cost === 0) return `${sym}0`;
  if (cost < 0.001) return `< ${sym}0.001`;
  return `${sym}${cost.toFixed(4)}`;
}

/** One-line price description for a pricing row (read-only display) */
function describePricing(row: PricingRow): string {
  const sym = row.currency === "CNY" ? "¥" : "$";
  if (row.isImageModel) {
    const parts = [`${sym}${row.pricePerImage}/张(输出)`];
    if (row.pricePerInputImage > 0)
      parts.push(`${sym}${row.pricePerInputImage}/张(输入)`);
    return parts.join(" + ");
  }
  const parts = [`${sym}${row.pricePerMInputTokens}/1M↑`, `${sym}${row.pricePerMOutputTokens}/1M↓`];
  if (row.pricePerMCachedInputTokens > 0)
    parts.push(`${sym}${row.pricePerMCachedInputTokens}/1M缓存`);
  return parts.join(" · ");
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
// Pricing editor row — adapts between text-model and image-model fields
// ---------------------------------------------------------------------------

type EditState = {
  currency: string;
  isImageModel: boolean;
  // text
  pricePerMInputTokens: string;
  pricePerMCachedInputTokens: string;
  pricePerMOutputTokens: string;
  // image
  pricePerImage: string;
  pricePerInputImage: string;
};

function rowToEdit(row: PricingRow): EditState {
  return {
    currency:                   row.currency,
    isImageModel:               row.isImageModel,
    pricePerMInputTokens:       String(row.pricePerMInputTokens),
    pricePerMCachedInputTokens: String(row.pricePerMCachedInputTokens),
    pricePerMOutputTokens:      String(row.pricePerMOutputTokens),
    pricePerImage:              String(row.pricePerImage),
    pricePerInputImage:         String(row.pricePerInputImage),
  };
}

function PricingEditorRow({
  row, onSave, onDelete,
}: {
  row: PricingRow;
  onSave: (r: PricingRow) => void;
  onDelete: (r: PricingRow) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [e, setE] = useState<EditState>(rowToEdit(row));

  const set = (k: keyof EditState) => (v: string | boolean) =>
    setE(prev => ({ ...prev, [k]: v }));

  const save = () => {
    onSave({
      ...row,
      currency:                   e.currency,
      isImageModel:               e.isImageModel,
      pricePerMInputTokens:       Number(e.pricePerMInputTokens),
      pricePerMCachedInputTokens: Number(e.pricePerMCachedInputTokens),
      pricePerMOutputTokens:      Number(e.pricePerMOutputTokens),
      pricePerImage:              Number(e.pricePerImage),
      pricePerInputImage:         Number(e.pricePerInputImage),
    });
    setEditing(false);
  };

  const cancel = () => { setE(rowToEdit(row)); setEditing(false); };

  if (!editing) {
    return (
      <tr className="border-b last:border-0">
        <td className="px-3 py-2 text-xs">{PROVIDER_LABELS[row.provider] ?? row.provider}</td>
        <td className="px-3 py-2 font-mono text-xs">{row.modelId}</td>
        <td className="px-3 py-2 text-xs">
          <Badge variant={row.isImageModel ? "outline" : "secondary"} className="text-xs">
            {row.isImageModel ? "图片" : "文本"}
          </Badge>
          <span className="ml-1.5 text-zinc-400">{row.currency}</span>
        </td>
        <td className="px-3 py-2 text-xs text-zinc-700">{describePricing(row)}</td>
        <td className="px-3 py-2 text-right">
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => setEditing(true)}>
              <Pencil size={12} className="text-zinc-400" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDelete(row)}>
              <Trash2 size={12} className="text-zinc-400" />
            </Button>
          </div>
        </td>
      </tr>
    );
  }

  return (
    <tr className="border-b last:border-0 bg-blue-50/30">
      <td className="px-3 py-2 text-xs">{PROVIDER_LABELS[row.provider] ?? row.provider}</td>
      <td className="px-3 py-2 font-mono text-xs">{row.modelId}</td>
      <td className="px-3 py-2">
        {/* Type + currency toggles */}
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            <button
              className={`rounded px-2 py-0.5 text-xs border ${!e.isImageModel ? "bg-zinc-800 text-white border-zinc-800" : "bg-white text-zinc-600 border-zinc-300"}`}
              onClick={() => set("isImageModel")(false)}
            >文本</button>
            <button
              className={`rounded px-2 py-0.5 text-xs border ${e.isImageModel ? "bg-zinc-800 text-white border-zinc-800" : "bg-white text-zinc-600 border-zinc-300"}`}
              onClick={() => set("isImageModel")(true)}
            >图片</button>
          </div>
          <div className="flex gap-1">
            {["CNY", "USD"].map(cur => (
              <button key={cur}
                className={`rounded px-2 py-0.5 text-xs border ${e.currency === cur ? "bg-zinc-800 text-white border-zinc-800" : "bg-white text-zinc-600 border-zinc-300"}`}
                onClick={() => set("currency")(cur)}
              >{cur}</button>
            ))}
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        {e.isImageModel ? (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输出/张</span>
              <Input value={e.pricePerImage} onChange={ev => set("pricePerImage")(ev.target.value)}
                className="h-6 w-20 text-xs text-right" />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输入图/张</span>
              <Input value={e.pricePerInputImage} onChange={ev => set("pricePerInputImage")(ev.target.value)}
                className="h-6 w-20 text-xs text-right" />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输入/1M</span>
              <Input value={e.pricePerMInputTokens} onChange={ev => set("pricePerMInputTokens")(ev.target.value)}
                className="h-6 w-20 text-xs text-right" />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">缓存/1M</span>
              <Input value={e.pricePerMCachedInputTokens} onChange={ev => set("pricePerMCachedInputTokens")(ev.target.value)}
                className="h-6 w-20 text-xs text-right" />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输出/1M</span>
              <Input value={e.pricePerMOutputTokens} onChange={ev => set("pricePerMOutputTokens")(ev.target.value)}
                className="h-6 w-20 text-xs text-right" />
            </label>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={save}>
            <Check size={12} className="text-emerald-600" />
          </Button>
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={cancel}>
            <X size={12} className="text-zinc-400" />
          </Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Add pricing form
// ---------------------------------------------------------------------------

function AddPricingForm({ onAdd }: { onAdd: () => void }) {
  const [provider, setProvider] = useState("");
  const [modelId,  setModelId]  = useState("");
  const [currency, setCurrency] = useState("CNY");
  const [isImage,  setIsImage]  = useState(false);
  const [inputP,   setInputP]   = useState("0");
  const [cachedP,  setCachedP]  = useState("0");
  const [outputP,  setOutputP]  = useState("0");
  const [perImage, setPerImage] = useState("0");
  const [perImgIn, setPerImgIn] = useState("0");
  const [saving,   setSaving]   = useState(false);

  const submit = async () => {
    if (!provider.trim() || !modelId.trim()) { toast.error("供应商和模型ID不能为空"); return; }
    setSaving(true);
    try {
      await api.put(
        `/billing/pricing/${encodeURIComponent(provider)}/${encodeURIComponent(modelId)}`,
        {
          currency,
          isImageModel:               isImage,
          pricePerMInputTokens:       isImage ? 0 : Number(inputP),
          pricePerMCachedInputTokens: isImage ? 0 : Number(cachedP),
          pricePerMOutputTokens:      isImage ? 0 : Number(outputP),
          pricePerImage:              isImage ? Number(perImage) : 0,
          pricePerInputImage:         isImage ? Number(perImgIn) : 0,
        }
      );
      setProvider(""); setModelId(""); setInputP("0"); setCachedP("0"); setOutputP("0");
      setPerImage("0"); setPerImgIn("0");
      onAdd();
    } catch { toast.error("保存失败"); } finally { setSaving(false); }
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
        <div className="flex flex-col gap-1">
          <div className="flex gap-1">
            {([false, true] as const).map(img => (
              <button key={String(img)}
                className={`rounded px-2 py-0.5 text-xs border ${isImage === img ? "bg-zinc-800 text-white border-zinc-800" : "bg-white text-zinc-600 border-zinc-300"}`}
                onClick={() => setIsImage(img)}
              >{img ? "图片" : "文本"}</button>
            ))}
          </div>
          <div className="flex gap-1">
            {["CNY", "USD"].map(cur => (
              <button key={cur}
                className={`rounded px-2 py-0.5 text-xs border ${currency === cur ? "bg-zinc-800 text-white border-zinc-800" : "bg-white text-zinc-600 border-zinc-300"}`}
                onClick={() => setCurrency(cur)}
              >{cur}</button>
            ))}
          </div>
        </div>
      </td>
      <td className="px-3 py-2">
        {isImage ? (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输出/张</span>
              <Input value={perImage} onChange={e => setPerImage(e.target.value)} className="h-6 w-20 text-xs text-right" />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输入图/张</span>
              <Input value={perImgIn} onChange={e => setPerImgIn(e.target.value)} className="h-6 w-20 text-xs text-right" />
            </label>
          </div>
        ) : (
          <div className="flex items-center gap-2 flex-wrap">
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输入/1M</span>
              <Input value={inputP} onChange={e => setInputP(e.target.value)} className="h-6 w-20 text-xs text-right" />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">缓存/1M</span>
              <Input value={cachedP} onChange={e => setCachedP(e.target.value)} className="h-6 w-20 text-xs text-right" />
            </label>
            <label className="flex items-center gap-1 text-xs">
              <span className="text-zinc-500 whitespace-nowrap">输出/1M</span>
              <Input value={outputP} onChange={e => setOutputP(e.target.value)} className="h-6 w-20 text-xs text-right" />
            </label>
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        <Button size="sm" className="h-6 text-xs px-3" disabled={saving} onClick={() => void submit()}>添加</Button>
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
      await api.put(
        `/billing/pricing/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.modelId)}`,
        {
          currency:                   row.currency,
          isImageModel:               row.isImageModel,
          pricePerMInputTokens:       row.pricePerMInputTokens,
          pricePerMCachedInputTokens: row.pricePerMCachedInputTokens,
          pricePerMOutputTokens:      row.pricePerMOutputTokens,
          pricePerImage:              row.pricePerImage,
          pricePerInputImage:         row.pricePerInputImage,
        }
      );
      toast.success("价格已更新");
      await load();
    } catch { toast.error("保存失败"); }
  };

  const handleDeletePricing = async (row: PricingRow) => {
    try {
      await api.delete(`/billing/pricing/${encodeURIComponent(row.provider)}/${encodeURIComponent(row.modelId)}`);
      toast.success("已删除");
      await load();
    } catch { toast.error("删除失败"); }
  };

  return (
    <div className="flex flex-col h-full">
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
            label="预估费用 (CNY)"
            value={summary ? `¥${summary.estimatedCostCny.toFixed(4)}` : "—"}
            sub={summary && summary.estimatedCostUsd > 0 ? `+ $${summary.estimatedCostUsd.toFixed(4)} USD` : "根据下方价格配置计算"}
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
                  <th className="px-3 py-2 text-right font-medium">Token(入/出)</th>
                  <th className="px-3 py-2 text-right font-medium">图片(出/入)</th>
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
                      {fmtNum(r.totalCalls)}
                      {r.failedCalls > 0 && (
                        <Badge variant="failed" className="ml-1.5 text-xs px-1 py-0">{r.failedCalls}失败</Badge>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-600">
                      {r.promptTokens || r.completionTokens
                        ? `${fmtNum(r.promptTokens)} / ${fmtNum(r.completionTokens)}`
                        : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-600">
                      {r.outputImageCount > 0 || r.inputImageCount > 0
                        ? `${fmtNum(r.outputImageCount)} / ${fmtNum(r.inputImageCount)}`
                        : <span className="text-zinc-300">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right text-xs text-zinc-500">
                      {r.avgDurationMs ? `${(r.avgDurationMs / 1000).toFixed(1)}s` : "—"}
                    </td>
                    <td className="px-3 py-2 text-right text-xs font-medium text-zinc-800">
                      {r.currency == null
                        ? <span className="text-zinc-400 text-xs">未配置价格</span>
                        : fmtCost(r.estimatedCost, r.currency)}
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
            文本模型按每百万 Token 配置，图片模型按每张配置。修改后立即生效于所有历史数据汇总。
          </p>
          <div className="overflow-x-auto rounded-md border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-zinc-50 text-xs text-zinc-500">
                  <th className="px-3 py-2 text-left font-medium">供应商</th>
                  <th className="px-3 py-2 text-left font-medium">模型ID</th>
                  <th className="px-3 py-2 text-left font-medium">类型 / 货币</th>
                  <th className="px-3 py-2 text-left font-medium">价格</th>
                  <th className="px-3 py-2 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {pricing.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-4 text-center text-xs text-zinc-400">暂无价格配置</td></tr>
                )}
                {pricing.map((r) => (
                  <PricingEditorRow key={r.id} row={r} onSave={handleSavePricing} onDelete={handleDeletePricing} />
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
