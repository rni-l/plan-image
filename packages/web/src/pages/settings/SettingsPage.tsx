import { useEffect, useRef, useState } from "react";
import { NavLink, useParams } from "react-router-dom";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Archive, CheckCircle, Circle, Copy, Download, FileText, Plus, Save, Star, Trash2, Upload } from "lucide-react";

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
  billingModelId: string | null;
  isDefault: boolean;
  providerName?: Provider["name"] | null;
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

interface PromptTemplate {
  id: string;
  type: "design_plan" | "image_generation";
  name: string;
  description: string | null;
  body: string;
  isBuiltIn: boolean;
  isDefault: boolean;
  archivedAt: number | null;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------

const SECTIONS = [
  { to: "/settings/models",  label: "模型供应商" },
  { to: "/settings/routing", label: "场景路由" },
  { to: "/settings/presets", label: "输出预设" },
  { to: "/settings/transfer", label: "数据迁移" },
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
        {section === "transfer" && <TransferSection />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Data transfer section
// ---------------------------------------------------------------------------

function TransferSection() {
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleConfigFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      if (!window.confirm("导入将替换模型路由和输出预设；不会修改当前 API 密钥。是否继续？")) return;
      try {
        JSON.parse(await file.text());
      } catch {
        toast.error("配置文件不是有效的 JSON");
        return;
      }
      await api.uploadRawFile("/settings/transfer/config", file, "application/json");
      toast.success("配置已导入");
    } catch {
      toast.error("导入配置失败，请重试");
    } finally {
      event.target.value = "";
    }
  }

  return (
    <div className="max-w-2xl">
      <h2 className="section-title mb-1 text-base text-zinc-900">数据迁移</h2>
      <p className="mb-6 text-sm text-zinc-500">导出或导入模型路由与输出预设配置。</p>
      <div className="rounded-lg border border-zinc-100 p-5">
        <p className="text-sm font-medium text-zinc-900">配置文件</p>
        <p className="mt-1 text-sm text-zinc-500">导入会替换模型路由和输出预设，当前 API 密钥不会变更。</p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" onClick={() => api.download("/settings/transfer/config", "configuration-export.json")}>
            <Download size={14} /> 导出配置
          </Button>
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload size={14} /> 导入配置
          </Button>
          <input ref={inputRef} type="file" accept="application/json,.json" className="hidden" onChange={handleConfigFile} />
        </div>
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
  onSave: (name: Provider["name"], apiKey: string, baseUrl?: string) => Promise<void>;
}) {
  const meta = PROVIDER_META[provider.name];
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(provider.baseUrl ?? "");
  const [saving, setSaving] = useState(false);

  // Sync baseUrl input when server data loads (initial state initialises before the fetch resolves)
  useEffect(() => {
    setBaseUrl(provider.baseUrl ?? "");
  }, [provider.baseUrl]);

  // Can save when:
  //  • a new API key was entered (first-time setup or key rotation), OR
  //  • provider already configured and the URL field has changed
  const baseUrlChanged =
    meta.hasBaseUrl && baseUrl.trim() !== (provider.baseUrl ?? "");
  const canSave =
    apiKey.trim().length > 0 || (provider.isConfigured && baseUrlChanged);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setSaving(true);
    try {
      // Pass empty string when no new key — server ignores it and keeps the stored key
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
              placeholder={provider.isConfigured ? "输入新密钥以更新（可留空仅改 URL）" : "粘贴 API 密钥"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <Button type="submit" disabled={!canSave || saving} size="sm">
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

function RoutingSection() {
  const sceneOrder = Object.keys(SCENE_LABELS);
  const [routes, setRoutes] = useState<SceneRoute[]>([]);
  const [adding, setAdding] = useState<string | null>(null);
  const [draft, setDraft] = useState({ providerName: "bailian" as ProviderName, modelId: "", billingModelId: "", parameters: "{}" });
  const load = () => api.get<SceneRoute[]>("/settings/routes").then(setRoutes).catch(() => toast.error("加载场景路由失败"));
  useEffect(() => { load(); }, []);
  async function create(scene: string) {
    try {
      await api.post("/settings/routes", { scene, providerName: draft.providerName, modelId: draft.modelId, billingModelId: draft.billingModelId || null, parameters: JSON.parse(draft.parameters || "{}") });
      setAdding(null); setDraft({ providerName: "bailian", modelId: "", billingModelId: "", parameters: "{}" }); load();
    } catch { toast.error("新增失败，请检查模型 ID 与 JSON 参数"); }
  }
  async function makeDefault(id: string) { await api.post(`/settings/routes/${id}/default`, {}); load(); }
  async function remove(id: string) { try { await api.delete(`/settings/routes/${id}`); load(); } catch { toast.error("默认模型需要先指定替代项"); } }

  return (
    <div className="max-w-4xl">
      <h2 className="section-title mb-1 text-base text-zinc-900">场景路由</h2>
      <p className="mb-6 text-sm text-zinc-500">
        每个场景可配置多个模型；带“默认”标记的模型会在操作面板中预选。提交后任务会冻结本次路由。
      </p>

      <div className="space-y-3">{sceneOrder.map((scene) => <section key={scene} className="rounded-lg border border-zinc-200">
        <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-4 py-2"><span className="text-sm font-medium">{SCENE_LABELS[scene]}</span><Button size="sm" variant="outline" onClick={() => setAdding(scene)}><Plus size={13} /> 新增模型</Button></div>
        {routes.filter((route) => route.scene === scene).map((route) => <div key={route.id} className="flex items-center gap-3 px-4 py-2 text-sm"><span className="w-28 text-zinc-600">{route.providerName ?? "未配置"}</span><code className="flex-1 truncate text-xs">{route.modelId ?? "未配置"}</code>{route.billingModelId && <span className="text-xs text-zinc-400">计费：{route.billingModelId}</span>}{route.isDefault ? <Badge>默认</Badge> : <Button size="sm" variant="ghost" onClick={() => makeDefault(route.id)}>设默认</Button>}<button className="text-zinc-400 hover:text-red-600" onClick={() => remove(route.id)}><Trash2 size={14} /></button></div>)}
        {adding === scene && <div className="grid gap-2 border-t border-zinc-100 p-3 md:grid-cols-[150px_1fr_1fr_auto]"><select className="h-9 rounded border border-zinc-200 px-2 text-sm" value={draft.providerName} onChange={(e) => setDraft({ ...draft, providerName: e.target.value as ProviderName })}>{PROVIDER_OPTIONS.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}</select><Input placeholder="模型 ID" value={draft.modelId} onChange={(e) => setDraft({ ...draft, modelId: e.target.value })} /><Input placeholder="计费模型 ID（可选）" value={draft.billingModelId} onChange={(e) => setDraft({ ...draft, billingModelId: e.target.value })} /><Button size="sm" disabled={!draft.modelId.trim()} onClick={() => create(scene)}>保存</Button></div>}
      </section>)}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Prompt template management
// ---------------------------------------------------------------------------

const PROMPT_VARIABLES: Record<PromptTemplate["type"], string[]> = {
  design_plan: [
    "product_name", "product_notes", "product_specifications", "selling_points",
    "product_visual_analysis", "competitor_insights", "user_ideas", "plan_count",
    "main_image_count", "detail_image_count", "output_types", "product_asset_ids",
  ],
  image_generation: [
    "product_name", "product_specifications", "product_selling_points", "product_visual_description",
    "direction_label", "direction_positioning", "direction_color_scheme", "direction_layout_intent",
    "direction_copy_strategy", "image_list_type", "image_title", "image_description",
    "image_selling_points", "image_suggested_copy", "image_composition_intent", "image_lighting",
    "image_angle", "image_background", "image_mood", "image_visual_elements", "product_asset_id",
    "reference_asset_ids", "width", "height", "aspect_ratio",
  ],
};

const SAMPLE_CONTEXT: Record<string, string | number> = {
  product_name: "示例商品", product_notes: "轻巧便携", product_specifications: "容量=500ml",
  selling_points: "便携；易清洁", product_visual_analysis: "白色圆柱形机身",
  competitor_insights: "同类多使用纯白背景", user_ideas: "清爽夏日感", plan_count: 3,
  main_image_count: 3, detail_image_count: 3, output_types: "主图 + 详情页图", product_asset_ids: "asset-1",
  product_selling_points: "便携；易清洁", product_visual_description: "白色圆柱形机身",
  direction_label: "清爽夏日", direction_positioning: "年轻通勤人群", direction_color_scheme: "薄荷绿与白色",
  direction_layout_intent: "商品居中，左侧留白", direction_copy_strategy: "短句直接",
  image_list_type: "主图", image_title: "清爽主图", image_description: "突出便携使用",
  image_selling_points: "便携、易清洁", image_suggested_copy: "随时鲜榨", image_composition_intent: "商品居中",
  image_lighting: "柔和自然光", image_angle: "前侧45度", image_background: "薄荷绿渐变",
  image_mood: "清爽、轻盈", image_visual_elements: "商品、水果、冰块", product_asset_id: "asset-1",
  reference_asset_ids: "", width: 1000, height: 1000, aspect_ratio: "1:1",
};

export function PromptTemplatesSection() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ type: PromptTemplate["type"]; name: string; description: string; body: string }>({
    type: "design_plan", name: "", description: "", body: "",
  });
  const [preview, setPreview] = useState<{ finalPrompt: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [archiveReplacementId, setArchiveReplacementId] = useState("");

  const load = () => api.get<PromptTemplate[]>("/settings/prompt-templates")
    .then((rows) => {
      setTemplates(rows);
      if (!selectedId && rows[0]) selectTemplate(rows[0], false);
    })
    .catch(() => toast.error("加载 Prompt 模板失败"));

  useEffect(() => { load(); }, []);

  function selectTemplate(template: PromptTemplate, updateSelection = true) {
    if (updateSelection) setSelectedId(template.id);
    else setSelectedId(template.id);
    setDraft({ type: template.type, name: template.name, description: template.description ?? "", body: template.body });
    setPreview(null);
    setArchiveReplacementId("");
  }

  function newTemplate(type: PromptTemplate["type"]) {
    setSelectedId("new");
    setDraft({ type, name: "", description: "", body: "" });
    setPreview(null);
    setArchiveReplacementId("");
  }

  async function saveTemplate() {
    if (!draft.name.trim() || !draft.body.trim()) return;
    setSaving(true);
    try {
      if (selectedId === "new") {
        const created = await api.post<PromptTemplate>("/settings/prompt-templates", draft);
        await load();
        selectTemplate(created);
      } else if (selectedId) {
        const updated = await api.patch<PromptTemplate>(`/settings/prompt-templates/${selectedId}`, {
          name: draft.name, description: draft.description, body: draft.body,
        });
        setTemplates((rows) => rows.map((row) => row.id === updated.id ? updated : row));
        selectTemplate(updated);
      }
      toast.success("Prompt 模板已保存");
    } catch {
      toast.error("保存失败，请检查模板变量和条件块");
    } finally {
      setSaving(false);
    }
  }

  async function previewTemplate() {
    try {
      const result = await api.post<{ finalPrompt: string }>("/prompts/render", {
        type: draft.type,
        templateBody: draft.body,
        contextVariables: SAMPLE_CONTEXT,
      });
      setPreview(result);
    } catch {
      toast.error("模板无法渲染，请检查未知变量或未闭合条件块");
    }
  }

  async function copyTemplate(template: PromptTemplate) {
    const created = await api.post<PromptTemplate>(`/settings/prompt-templates/${template.id}/copy`, {});
    await load();
    selectTemplate(created);
    toast.success("已复制为自定义模板");
  }

  async function makeDefault(template: PromptTemplate) {
    await api.post(`/settings/prompt-templates/${template.id}/default`, {});
    await load();
    toast.success("已设为默认模板");
  }

  async function archiveTemplate(template: PromptTemplate) {
    if (template.isDefault && !archiveReplacementId) {
      toast.error("请先指定替代默认模板");
      return;
    }
    await api.post(`/settings/prompt-templates/${template.id}/archive`, template.isDefault
      ? { replacementTemplateId: archiveReplacementId }
      : {});
    setSelectedId(null);
    await load();
    toast.success("模板已归档");
  }

  const selected = templates.find((template) => template.id === selectedId);
  return (
    <div className="max-w-6xl">
      <div className="mb-6">
        <h2 className="section-title mb-1 text-base text-zinc-900">Prompt 管理</h2>
        <p className="text-sm text-zinc-500">内置模板只读；自定义模板支持默认切换和软归档。固定输出契约始终锁定。</p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        {(["design_plan", "image_generation"] as const).map((type) => (
          <div key={type} className="overflow-hidden rounded-lg border border-zinc-200">
            <div className="flex items-center justify-between border-b border-zinc-100 bg-zinc-50 px-3 py-2">
              <span className="text-sm font-medium">{type === "design_plan" ? "方案生成" : "图片生成"}</span>
              <Button size="sm" variant="outline" className="h-7" onClick={() => newTemplate(type)}><Plus size={12} /> 新建</Button>
            </div>
            <div className="divide-y divide-zinc-100">
              {templates.filter((template) => template.type === type).map((template) => (
                <button key={template.id} onClick={() => selectTemplate(template)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left ${selectedId === template.id ? "bg-zinc-100" : "hover:bg-zinc-50"}`}>
                  <FileText size={13} className="text-zinc-400" />
                  <span className="flex-1 truncate text-sm">{template.name}</span>
                  {template.isBuiltIn && <Badge variant="secondary">内置</Badge>}
                  {template.isDefault && <Star size={12} className="fill-amber-400 text-amber-400" />}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {selectedId && (
        <div className="mt-6 grid grid-cols-[1fr_280px] gap-5 rounded-lg border border-zinc-200 p-5">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div><Label>模板名称</Label><Input className="mt-1" value={draft.name} disabled={selected?.isBuiltIn} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></div>
              <div><Label>说明</Label><Input className="mt-1" value={draft.description} disabled={selected?.isBuiltIn} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></div>
            </div>
            <div><Label>模板正文</Label><Textarea rows={16} className="mt-1 font-mono text-xs" value={draft.body} disabled={selected?.isBuiltIn} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={previewTemplate}>最终预览</Button>
              {selected?.isBuiltIn ? (
                <Button onClick={() => copyTemplate(selected)}><Copy size={13} /> 复制后编辑</Button>
              ) : (
                <Button onClick={saveTemplate} disabled={saving || !draft.name.trim() || !draft.body.trim()}><Save size={13} /> 保存</Button>
              )}
              {selected && !selected.isDefault && <Button variant="outline" onClick={() => makeDefault(selected)}><Star size={13} /> 设为默认</Button>}
              {selected && !selected.isBuiltIn && <Button variant="outline" onClick={() => archiveTemplate(selected)}><Archive size={13} /> 归档</Button>}
            </div>
            {selected?.isDefault && !selected.isBuiltIn && (
              <div>
                <Label>归档后的替代默认模板</Label>
                <select
                  className="mt-1 h-9 w-full rounded-md border border-zinc-200 bg-white px-2 text-sm"
                  value={archiveReplacementId}
                  onChange={(event) => setArchiveReplacementId(event.target.value)}
                >
                  <option value="">请先选择替代模板</option>
                  {templates
                    .filter((template) => template.type === selected.type && template.id !== selected.id && !template.archivedAt)
                    .map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </select>
              </div>
            )}
            {preview && <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-zinc-950 p-4 text-[11px] leading-relaxed text-zinc-100">{preview.finalPrompt}</pre>}
          </div>
          <aside>
            <p className="mb-2 text-xs font-medium text-zinc-700">可用变量</p>
            <div className="flex flex-wrap gap-1.5">
              {PROMPT_VARIABLES[draft.type].map((variable) => <code key={variable} className="rounded bg-zinc-100 px-1.5 py-1 text-[10px] text-zinc-600">{`{{${variable}}}`}</code>)}
            </div>
            <p className="mt-4 text-xs leading-relaxed text-zinc-500">条件语法：<code>{"{{#if variable}}...{{/if}}"}</code>。不支持嵌套；未知变量和未闭合条件会阻止保存。</p>
          </aside>
        </div>
      )}
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
