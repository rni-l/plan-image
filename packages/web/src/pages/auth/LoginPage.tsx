import { useState, type FormEvent } from "react";
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
        <h1 className="text-xl font-semibold tracking-tight text-zinc-900">商品图片工作台</h1>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <Input
            aria-label="密码"
            autoFocus
            autoComplete="current-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
          <Button className="w-full" size="lg" type="submit" disabled={submitting}>
            {submitting ? "登录中…" : "登录"}
          </Button>
        </form>
      </section>
    </main>
  );
}
