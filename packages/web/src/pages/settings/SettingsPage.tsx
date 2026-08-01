import { useEffect, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Circle, Plus, Trash2, Save } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Provider {
  id: string;
  name: "bailian" | "volcengine" | "gpt_proxy";
  baseUrl: string | null;
  isConfigured: boolean;
  keyHint: string | null;
  updatedAt: number;
}

interface SceneRoute {
  id: string;
  scene: string;
  providerId: string | null;
  modelId: string | null;
  parameters: string | null;
  updatedAt: number;
}

interface OutputPreset {
  id: string;
  name: string;
  presetType: "main_image" | "detail_module";
  width: number;
  height: number;
  format: "jpg" | "png";
  quality: number;
  isDefault: boolean;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const SECTIONS = [
  { to: "/settings/models",  label: "模型供应商" },
  { to: "/settings/routing", label: "场景路由" },
  { to: "/settings/presets", label: "输出预设" },
] as const;

export function SettingsPage() {
  const { section } = useParams<{ section: string }>();

  return (
    <div className="flex h-full gap-0">
      <aside className="w-44 shrink-0 border-r border-zinc-200 bg-zinc-50 px-2 py-4">
        <p className="mb-2 px-3 text-xs font-medium uppercase tracking-wider text-zinc-400">
          设置
        </p>
        {SECTIONS.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `block rounded-md px-3 py-1.5 text-sm transition-colors ${
                isActive
                  ? "bg-zinc-100 font-medium text-zinc-900"
                  : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900"
              }`
            }
          >
            {label}
          </NavLink>
        ))}
      </aside>

      <div className="flex-1 overflow-y-auto px-8 py-8">
        {section === "models"  && <ModelsSection />}
        {section === "routing" && <RoutingSection />}
        {section === "presets" && <PresetsSection />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 1. Models section
// ---------------------------------------------------------------------------

const PROVIDER_META: Record<Provider["name"], { label: string; hasBaseUrl: boolean }> = {
  bailian:    { label: "阿里云百炼",   hasBaseUrl: false },
  volcengine: { label: "火山方舟/豆包", hasBaseUrl: false },
  gpt_proxy:  { label: "GPT 中转服务", hasBaseUrl: true  },
};

function ModelsSection() {
  const [providers, setProviders] = useState<Provider[]>([]);

  useEffect(() => {
    api.get<Provider[]>("/settings/providers").then(setProviders).catch(() => {
      toast.error("加载供应商配置失败");
    });
  }, []);

  // Ensure all 3 providers are shown even if not in DB yet
  const allNames: Provider["name"][] = ["bailian", "volcengine", "gpt_proxy"];
  const displayed = allNames.map(
    (name) => providers.find((p) => p.name === name) ?? { id: "", name, baseUrl: null, isConfigured: false, keyHint: null, updatedAt: 0 }
  );

  async function handleSave(
    name: Provider["name"],
    apiKey: string,
    baseUrl?: string,
    modelId?: string
  ) {
    await api.put<Provider>(`/settings/providers/${name}`, { apiKey, baseUrl, modelId });
    const updated = await api.get<Provider[]>("/settings/providers");
    setProviders(updated);
    toast.success("API 密钥已保存");
  }

  return (
    <div className="max-w-2xl">
      <h2 className="section-title mb-1 text-base text-zinc-900">模型供应商</h2>
      <p className="mb-6 text-sm text-zinc-500">
        密钥只保存在本机，不上传到任何服务器。
      </p>
      <div className="flex flex-col gap-4">
        {displayed.map((p) => (
          <ProviderCard
            key={p.name}
            provider={p as Provider}
            onSave={handleSave}
          />
        ))}
      </div>
    </div>
  );
}

function ProviderCard({
  provider,
  onSave,
}: {
  provider: Provider;
  onSave: (name: Provider["name"], apiKey: string, baseUrl?: string, modelId?: string) => Promise<void>;
}) {
  const meta = PROVIDER_META[provider.name];
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;
    setSaving(true);
    try {
      await onSave(provider.name, apiKey.trim(), baseUrl.trim() || undefined);
      setApiKey("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-zinc-100 p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm font-medium text-zinc-900">{meta.label}</span>
        {provider.isConfigured ? (
          <span className="flex items-center gap-1 text-xs text-green-600">
            <CheckCircle size={12} /> 已配置
          </span>
        ) : (
          <span className="flex items-center gap-1 text-xs text-zinc-400">
            <Circle size={12} /> 未配置
          </span>
        )}
        {provider.isConfigured && provider.keyHint && (
          <span className="ml-auto font-mono text-xs text-zinc-400">
            ••••{provider.keyHint}
          </span>
        )}
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        {meta.hasBaseUrl && (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${provider.name}-baseurl`}>Base URL</Label>
            <Input
              id={`${provider.name}-baseurl`}
              placeholder="https://api.example.com"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
            />
          </div>
        )}
        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              type="password"
              placeholder={provider.isConfigured ? "输入新密钥以更新" : "粘贴 API 密钥"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!apiKey.trim() || saving} size="sm">
            <Save size={14} />
            {saving ? "保存中…" : "保存"}
          </Button>
        </div>
      </form>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 2. Routing section
// ---------------------------------------------------------------------------

const SCENE_LABELS: Record<string, string> = {
  competitor_image_analysis: "竞品图片分析",
  competitor_synthesis:      "综合规律总结",
  design_plan:               "设计方案生成",
  image_generation:          "图片生成",
  image_edit:                "图片微调",
};

const PROVIDER_OPTIONS = [
  { name: "bailian",    label: "阿里云百炼" },
  { name: "volcengine", label: "火山方舟/豆包" },
  { name: "gpt_proxy",  label: "GPT 中转服务" },
] as const;

type ProviderName = (typeof PROVIDER_OPTIONS)[number]["name"];

type RowState = {
  providerName: ProviderName | "";
  modelId: string;
  dirty: boolean;
  saving: boolean;
};

function RoutingSection() {
  const sceneOrder = Object.keys(SCENE_LABELS);
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      sceneOrder.map((s) => [s, { providerName: "", modelId: "", dirty: false, saving: false }])
    )
  );

  useEffect(() => {
    api
      .get<Array<{ scene: string; providerName: string | null; modelId: string | null }>>(
        "/settings/routes"
      )
      .then((routes) => {
        setRows((prev) => {
          const next = { ...prev };
          for (const r of routes) {
            next[r.scene] = {
              providerName: (r.providerName ?? "") as ProviderName | "",
              modelId: r.modelId ?? "",
              dirty: false,
              saving: false,
            };
          }
          return next;
        });
      })
      .catch(() => toast.error("加载场景路由失败"));
  }, []);

  function update(scene: string, field: "providerName" | "modelId", value: string) {
    setRows((prev) => ({
      ...prev,
      [scene]: { ...prev[scene]!, [field]: value, dirty: true },
    }));
  }

  async function save(scene: string) {
    const row = rows[scene];
    if (!row?.providerName || !row.modelId.trim()) {
      toast.error("请选择供应商并填写模型 ID");
      return;
    }
    setRows((prev) => ({ ...prev, [scene]: { ...prev[scene]!, saving: true } }));
    try {
      await api.put(`/settings/routes/${scene}`, {
        providerName: row.providerName,
        modelId: row.modelId.trim(),
      });
      setRows((prev) => ({ ...prev, [scene]: { ...prev[scene]!, dirty: false, saving: false } }));
      toast.success("已保存");
    } catch {
      toast.error("保存失败");
      setRows((prev) => ({ ...prev, [scene]: { ...prev[scene]!, saving: false } }));
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="section-title mb-1 text-base text-zinc-900">场景路由</h2>
      <p className="mb-6 text-sm text-zinc-500">
        每个场景独立配置模型，修改不影响已提交的任务。
      </p>

      <div className="overflow-hidden rounded-lg border border-zinc-200">
        {sceneOrder.map((scene, i) => {
          const row = rows[scene] ?? { providerName: "", modelId: "", dirty: false, saving: false };
          const canSave = row.dirty && !!row.providerName && !!row.modelId.trim();
          return (
            <div
              key={scene}
              className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? "border-t border-zinc-100" : ""}`}
            >
              <span className="w-32 shrink-0 text-sm text-zinc-700">
                {SCENE_LABELS[scene]}
              </span>

              {/* Provider — always shows all 3 options */}
              <select
                className="h-8 w-36 shrink-0 rounded-md border border-zinc-200 bg-white px-2 text-sm text-zinc-900 focus:outline-none focus:ring-1 focus:ring-zinc-900"
                value={row.providerName}
                onChange={(e) => update(scene, "providerName", e.target.value)}
              >
                <option value="">— 供应商 —</option>
                {PROVIDER_OPTIONS.map((p) => (
                  <option key={p.name} value={p.name}>{p.label}</option>
                ))}
              </select>

              {/* Model ID */}
              <Input
                className="flex-1"
                placeholder="模型 ID，如 qwen-vl-max"
                value={row.modelId}
                onChange={(e) => update(scene, "modelId", e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSave && save(scene)}
              />

              {/* Save button */}
              <Button
                size="sm"
                variant={canSave ? "default" : "ghost"}
                disabled={!canSave || row.saving}
                onClick={() => save(scene)}
                className="w-14 shrink-0"
              >
                {row.saving ? "…" : "保存"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 3. Presets section
// ---------------------------------------------------------------------------

function PresetsSection() {
  const [presets, setPresets] = useState<OutputPreset[]>([]);
  const [adding, setAdding]   = useState(false);

  useEffect(() => {
    api.get<OutputPreset[]>("/settings/presets").then(setPresets).catch(() =>
      toast.error("加载预设失败")
    );
  }, []);

  async function handleUpdate(id: string, patch: Partial<OutputPreset>) {
    try {
      const updated = await api.patch<OutputPreset>(`/settings/presets/${id}`, patch);
      setPresets((prev) => prev.map((p) => (p.id === id ? updated : p)));
    } catch {
      toast.error("保存失败");
    }
  }

  async function handleDelete(id: string) {
    await api.delete(`/settings/presets/${id}`);
    setPresets((prev) => prev.filter((p) => p.id !== id));
    toast.success("预设已删除");
  }

  async function handleAdd(preset: Omit<OutputPreset, "id" | "isDefault">) {
    const created = await api.post<OutputPreset>("/settings/presets", preset);
    setPresets((prev) => [...prev, created]);
    setAdding(false);
    toast.success("预设已创建");
  }

  return (
    <div className="max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="section-title mb-1 text-base text-zinc-900">输出预设</h2>
          <p className="text-sm text-zinc-500">创建任务时可选择预设，任务保存快照不受后续修改影响。</p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
          <Plus size={14} />
          新建预设
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-zinc-100 bg-zinc-50 text-xs text-zinc-500">
              <th className="px-4 py-2 text-left font-medium">名称</th>
              <th className="px-4 py-2 text-left font-medium">类型</th>
              <th className="px-4 py-2 text-left font-medium">尺寸</th>
              <th className="px-4 py-2 text-left font-medium">格式</th>
              <th className="px-4 py-2 text-left font-medium">质量</th>
              <th className="px-4 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100">
            {presets.map((preset) => (
              <PresetRow
                key={preset.id}
                preset={preset}
                onUpdate={(patch) => handleUpdate(preset.id, patch)}
                onDelete={() => handleDelete(preset.id)}
              />
            ))}
            {adding && (
              <NewPresetRow
                onSave={handleAdd}
                onCancel={() => setAdding(false)}
              />
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PresetRow({
  preset,
  onUpdate,
  onDelete,
}: {
  preset: OutputPreset;
  onUpdate: (patch: Partial<OutputPreset>) => void;
  onDelete: () => void;
}) {
  return (
    <tr className="group hover:bg-zinc-50">
      <td className="px-4 py-2">
        <InlineEdit
          value={preset.name}
          onCommit={(v) => onUpdate({ name: v })}
        />
      </td>
      <td className="px-4 py-2 text-zinc-500">
        {preset.presetType === "main_image" ? "主图" : "详情模块"}
      </td>
      <td className="px-4 py-2 font-mono text-zinc-700">
        {preset.width} × {preset.height}
      </td>
      <td className="px-4 py-2 uppercase text-zinc-500">{preset.format}</td>
      <td className="px-4 py-2 text-zinc-500">{preset.quality}</td>
      <td className="px-4 py-2 text-right">
        {!preset.isDefault && (
          <button
            onClick={onDelete}
            className="invisible text-zinc-400 hover:text-red-600 group-hover:visible"
          >
            <Trash2 size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

function NewPresetRow({
  onSave,
  onCancel,
}: {
  onSave: (p: Omit<OutputPreset, "id" | "isDefault">) => void;
  onCancel: () => void;
}) {
  const [name, setName]           = useState("");
  const [presetType, setPresetType] = useState<"main_image" | "detail_module">("main_image");
  const [width, setWidth]         = useState(1000);
  const [height, setHeight]       = useState(1000);
  const [format, setFormat]       = useState<"jpg" | "png">("jpg");
  const [quality, setQuality]     = useState(90);

  function handleSave() {
    if (!name.trim()) return;
    onSave({ name: name.trim(), presetType, width, height, format, quality });
  }

  return (
    <tr className="bg-zinc-50">
      <td className="px-4 py-2">
        <Input
          autoFocus
          className="h-7 text-xs"
          placeholder="预设名称"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </td>
      <td className="px-4 py-2">
        <select
          className="h-7 rounded border border-zinc-200 px-1 text-xs"
          value={presetType}
          onChange={(e) => setPresetType(e.target.value as typeof presetType)}
        >
          <option value="main_image">主图</option>
          <option value="detail_module">详情模块</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <Input
            type="number"
            className="h-7 w-16 text-xs"
            value={width}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <span className="text-zinc-400">×</span>
          <Input
            type="number"
            className="h-7 w-16 text-xs"
            value={height}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
        </div>
      </td>
      <td className="px-4 py-2">
        <select
          className="h-7 rounded border border-zinc-200 px-1 text-xs"
          value={format}
          onChange={(e) => setFormat(e.target.value as typeof format)}
        >
          <option value="jpg">JPG</option>
          <option value="png">PNG</option>
        </select>
      </td>
      <td className="px-4 py-2">
        <Input
          type="number"
          className="h-7 w-14 text-xs"
          value={quality}
          min={1}
          max={100}
          onChange={(e) => setQuality(Number(e.target.value))}
        />
      </td>
      <td className="px-4 py-2">
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={onCancel} className="h-7 text-xs">取消</Button>
          <Button size="sm" onClick={handleSave} className="h-7 text-xs" disabled={!name.trim()}>保存</Button>
        </div>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Inline editable cell
// ---------------------------------------------------------------------------

function InlineEdit({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft]     = useState(value);

  if (!editing) {
    return (
      <button
        onClick={() => { setDraft(value); setEditing(true); }}
        className="rounded px-1 text-left hover:bg-zinc-100"
      >
        {value}
      </button>
    );
  }

  return (
    <Input
      autoFocus
      className="h-7 text-xs"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { onCommit(draft); setEditing(false); }}
      onKeyDown={(e) => {
        if (e.key === "Enter")  { onCommit(draft); setEditing(false); }
        if (e.key === "Escape") { setDraft(value); setEditing(false); }
      }}
    />
  );
}
