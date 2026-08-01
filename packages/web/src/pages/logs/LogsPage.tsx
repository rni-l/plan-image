import { useEffect, useState, useCallback } from "react";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RefreshCw, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ApiRequestLog {
  id: string;
  method: string;
  path: string;
  queryString: string | null;
  requestBody: string | null;
  responseBody: string | null;
  statusCode: number | null;
  durationMs: number | null;
  createdAt: number;
}

interface LlmCallLog {
  id: string;
  jobId: string | null;
  scene: string;
  provider: string;
  model: string;
  status: string;
  errorType: string | null;
  errorMessage: string | null;
  requestPrompt: string | null;
  requestParams: string | null;
  responseBody: string | null;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  createdAt: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PROVIDER_LABELS: Record<string, string> = {
  bailian:    "百炼",
  volcengine: "火山方舟",
  gpt_proxy:  "GPT中转",
};

const SCENE_LABELS: Record<string, string> = {
  competitor_image_analysis: "竞品图分析",
  competitor_synthesis:      "竞品综合",
  design_plan:               "设计方案",
  image_generation:          "图片生成",
  image_edit:                "图片编辑",
};

function fmtTime(ts: number) {
  return new Date(ts).toLocaleString("zh-CN", {
    month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function fmtDuration(ms: number | null) {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function MethodBadge({ method }: { method: string }) {
  const colours: Record<string, string> = {
    GET:    "bg-emerald-100 text-emerald-700",
    POST:   "bg-blue-100 text-blue-700",
    PUT:    "bg-amber-100 text-amber-700",
    PATCH:  "bg-orange-100 text-orange-700",
    DELETE: "bg-red-100 text-red-700",
  };
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold ${colours[method] ?? "bg-zinc-100 text-zinc-600"}`}>
      {method}
    </span>
  );
}

function StatusBadge({ code }: { code: number | null }) {
  if (code == null) return <span className="text-zinc-400">—</span>;
  const cls =
    code < 300 ? "bg-emerald-100 text-emerald-700" :
    code < 500 ? "bg-amber-100 text-amber-700"     :
                 "bg-red-100 text-red-700";
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono font-semibold ${cls}`}>
      {code}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Subpages
// ---------------------------------------------------------------------------

function ApiRequestsTab() {
  const [rows, setRows]   = useState<ApiRequestLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [method, setMethod]     = useState("all");
  const [status, setStatus]     = useState("all");
  const [loading, setLoading]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (method !== "all") params.set("method", method);
      if (status !== "all") params.set("status", status);
      const res = await api.get<{ data: ApiRequestLog[]; total: number }>(
        `/logs/api-requests?${params}`
      );
      setRows(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, method, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [method, status]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <select
          value={method}
          onChange={e => setMethod(e.target.value)}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none"
        >
          <option value="all">全部方法</option>
          {["GET","POST","PUT","PATCH","DELETE"].map(m => <option key={m} value={m}>{m}</option>)}
        </select>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none"
        >
          <option value="all">全部状态</option>
          <option value="2xx">2xx 成功</option>
          <option value="4xx">4xx 客户端错误</option>
          <option value="5xx">5xx 服务器错误</option>
        </select>

        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          共 {total} 条
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-xs text-zinc-500">
              <th className="w-6 px-3 py-2" />
              <th className="px-3 py-2 text-left font-medium">时间</th>
              <th className="px-3 py-2 text-left font-medium">方法</th>
              <th className="px-3 py-2 text-left font-medium">路径</th>
              <th className="px-3 py-2 text-left font-medium">状态</th>
              <th className="px-3 py-2 text-right font-medium">耗时</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-zinc-400">暂无数据</td></tr>
            )}
            {rows.map((r) => (
              <>
                <tr
                  key={r.id}
                  className="border-b cursor-pointer hover:bg-zinc-50/70"
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                >
                  <td className="px-3 py-2 text-zinc-400">
                    {expandedId === r.id
                      ? <ChevronDown size={12} />
                      : <ChevronRightIcon size={12} />}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{fmtTime(r.createdAt)}</td>
                  <td className="px-3 py-2"><MethodBadge method={r.method} /></td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700 max-w-[320px] truncate">
                    {r.path}{r.queryString ?? ""}
                  </td>
                  <td className="px-3 py-2"><StatusBadge code={r.statusCode} /></td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-500">{fmtDuration(r.durationMs)}</td>
                </tr>
                {expandedId === r.id && (
                  <tr key={`${r.id}-detail`} className="bg-zinc-50 border-b">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div>
                          <p className="mb-1 font-medium text-zinc-600">请求体</p>
                          <pre className="max-h-60 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all">
                            {r.requestBody ?? "（无请求体）"}
                          </pre>
                        </div>
                        <div>
                          <p className="mb-1 font-medium text-zinc-600">响应体{(r.statusCode ?? 0) < 400 ? "（仅记录错误响应）" : ""}</p>
                          <pre className="max-h-60 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all">
                            {r.responseBody ?? "—"}
                          </pre>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>第 {page} / {totalPages} 页</span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={13} />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}

function LlmCallsTab() {
  const [rows, setRows]   = useState<LlmCallLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage]   = useState(1);
  const [provider, setProvider] = useState("all");
  const [status, setStatus]     = useState("all");
  const [loading, setLoading]   = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const LIMIT = 50;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
      if (provider !== "all") params.set("provider", provider);
      if (status   !== "all") params.set("status", status);
      const res = await api.get<{ data: LlmCallLog[]; total: number }>(
        `/logs/llm-calls?${params}`
      );
      setRows(res.data);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, [page, provider, status]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setPage(1); }, [provider, status]);

  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="flex flex-col gap-3">
      {/* Filters */}
      <div className="flex items-center gap-2">
        <select
          value={provider}
          onChange={e => setProvider(e.target.value)}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none"
        >
          <option value="all">全部供应商</option>
          <option value="bailian">百炼</option>
          <option value="volcengine">火山方舟</option>
          <option value="gpt_proxy">GPT中转</option>
        </select>

        <select
          value={status}
          onChange={e => setStatus(e.target.value)}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-700 focus:outline-none"
        >
          <option value="all">全部状态</option>
          <option value="succeeded">成功</option>
          <option value="failed">失败</option>
        </select>

        <div className="ml-auto flex items-center gap-2 text-xs text-zinc-500">
          共 {total} 条
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void load()}>
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-zinc-50 text-xs text-zinc-500">
              <th className="w-6 px-3 py-2" />
              <th className="px-3 py-2 text-left font-medium">时间</th>
              <th className="px-3 py-2 text-left font-medium">场景</th>
              <th className="px-3 py-2 text-left font-medium">供应商</th>
              <th className="px-3 py-2 text-left font-medium">模型</th>
              <th className="px-3 py-2 text-left font-medium">状态</th>
              <th className="px-3 py-2 text-right font-medium">耗时</th>
              <th className="px-3 py-2 text-right font-medium">输入Token</th>
              <th className="px-3 py-2 text-right font-medium">输出Token</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-8 text-center text-xs text-zinc-400">暂无数据</td></tr>
            )}
            {rows.map((r) => (
              <>
                <tr
                  key={r.id}
                  className={`border-b cursor-pointer hover:bg-zinc-50/70 ${r.status === "failed" ? "bg-red-50/30" : ""}`}
                  onClick={() => setExpandedId(expandedId === r.id ? null : r.id)}
                >
                  <td className="px-3 py-2 text-zinc-400">
                    {expandedId === r.id
                      ? <ChevronDown size={12} />
                      : <ChevronRightIcon size={12} />}
                  </td>
                  <td className="px-3 py-2 text-xs text-zinc-500 whitespace-nowrap">{fmtTime(r.createdAt)}</td>
                  <td className="px-3 py-2 text-xs">{SCENE_LABELS[r.scene] ?? r.scene}</td>
                  <td className="px-3 py-2 text-xs">{PROVIDER_LABELS[r.provider] ?? r.provider}</td>
                  <td className="px-3 py-2 font-mono text-xs text-zinc-700 max-w-[160px] truncate">{r.model}</td>
                  <td className="px-3 py-2">
                    <Badge variant={r.status === "succeeded" ? "succeeded" : "failed"} className="text-xs px-1.5 py-0">
                      {r.status === "succeeded" ? "成功" : "失败"}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-500">{fmtDuration(r.durationMs)}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-500">{r.promptTokens?.toLocaleString() ?? "—"}</td>
                  <td className="px-3 py-2 text-right text-xs text-zinc-500">{r.completionTokens?.toLocaleString() ?? "—"}</td>
                </tr>
                {expandedId === r.id && (
                  <tr key={`${r.id}-detail`} className="bg-zinc-50 border-b">
                    <td colSpan={9} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-3 text-xs">
                        <div className="flex flex-col gap-2">
                          <div>
                            <p className="mb-1 font-medium text-zinc-600">Prompt（发送给模型的内容）</p>
                            <pre className="max-h-72 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all">
                              {r.requestPrompt ?? "—"}
                            </pre>
                          </div>
                          <div>
                            <p className="mb-1 font-medium text-zinc-600">请求参数</p>
                            <pre className="max-h-36 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap">
                              {r.requestParams ?? "—"}
                            </pre>
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <div>
                            <p className="mb-1 font-medium text-zinc-600">响应内容</p>
                            <pre className="max-h-56 overflow-auto rounded border border-zinc-200 bg-white p-2 text-zinc-700 whitespace-pre-wrap break-all">
                              {r.responseBody ?? "—"}
                            </pre>
                          </div>
                          {r.errorMessage && (
                            <div>
                              <p className="mb-1 font-medium text-red-600">错误信息</p>
                              <pre className="max-h-24 overflow-auto rounded border border-red-200 bg-red-50 p-2 text-red-700 whitespace-pre-wrap break-all">
                                {r.errorMessage}
                              </pre>
                            </div>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>第 {page} / {totalPages} 页</span>
        <div className="flex gap-1">
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>
            <ChevronLeft size={13} />
          </Button>
          <Button variant="outline" size="icon" className="h-7 w-7" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
            <ChevronRight size={13} />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Tab = "api" | "llm";

export function LogsPage() {
  const [tab, setTab] = useState<Tab>("api");

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h1 className="text-base font-semibold text-zinc-900">日志记录</h1>
      </div>

      <div className="flex flex-col gap-4 p-6 flex-1 min-h-0 overflow-y-auto">
        {/* Tabs */}
        <div className="flex gap-1 rounded-lg bg-zinc-100 p-1 w-fit">
          {([["api", "接口请求"], ["llm", "LLM调用"]] as [Tab, string][]).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={`rounded-md px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === id
                  ? "bg-white text-zinc-900 shadow-sm"
                  : "text-zinc-500 hover:text-zinc-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === "api" && <ApiRequestsTab />}
        {tab === "llm" && <LlmCallsTab />}
      </div>
    </div>
  );
}
