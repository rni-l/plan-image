import { useState, type FormEvent } from "react";
import { LockKeyhole } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { api } from "@/lib/api.js";

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const from = (location.state as { from?: string } | null)?.from || "/products";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await api.post("/auth/login", { password });
      navigate(from, { replace: true });
    } catch {
      setError("密码不正确，请重试。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-zinc-50 px-4">
      <section className="w-full max-w-sm rounded-xl border border-zinc-200 bg-white p-7 shadow-sm">
        <div className="mb-6 flex size-10 items-center justify-center rounded-lg bg-zinc-900 text-white">
          <LockKeyhole size={19} />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">商品图片工作台</h1>
        <p className="mt-1 text-sm text-zinc-500">请输入密码以继续使用。</p>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block space-y-1.5 text-sm font-medium text-zinc-700">
            <span>密码</span>
            <Input
              autoFocus
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="输入登录密码"
              required
            />
          </label>
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <Button className="w-full" size="lg" type="submit" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </Button>
        </form>

        <p className="mt-5 border-t border-zinc-100 pt-4 text-xs leading-5 text-zinc-500">
          初始默认密码：<code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-700">admin123456</code>
          <br />部署前可通过 <code className="rounded bg-zinc-100 px-1 py-0.5 text-zinc-700">ADMIN_PASSWORD</code> 修改。
        </p>
      </section>
    </main>
  );
}
