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
    <main className="min-h-screen bg-[#f3f1ee] p-3 text-zinc-900 sm:p-5">
      <div className="grid min-h-[calc(100vh-1.5rem)] overflow-hidden border border-zinc-900/10 bg-[#faf9f7] shadow-[0_24px_80px_rgba(41,37,36,0.12)] sm:min-h-[calc(100vh-2.5rem)] lg:grid-cols-[minmax(0,1.25fr)_minmax(360px,0.75fr)]">
        <section className="relative isolate hidden overflow-hidden bg-[#242b2d] text-white lg:block" aria-hidden="true">
          <div className="absolute inset-0 opacity-90 [background-image:linear-gradient(rgba(255,255,255,0.11)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.11)_1px,transparent_1px)] [background-size:72px_72px]" />
          <div className="absolute -left-[18%] top-[12%] h-[74%] w-[76%] rotate-[-17deg] border border-white/20" />
          <div className="absolute left-[10%] top-[17%] h-[43%] w-[32%] bg-[#d3b58f] shadow-[18px_22px_0_rgba(11,18,20,0.3)]" />
          <div className="absolute left-[36%] top-[29%] h-[37%] w-[27%] bg-[#b36b4e]" />
          <div className="absolute left-[57%] top-[14%] h-[56%] w-[25%] bg-[#d7ded7]" />
          <div className="absolute bottom-[14%] left-[21%] h-[27%] w-[23%] bg-[#71877f]" />
          <div className="absolute bottom-[9%] right-[12%] h-[42%] w-[29%] bg-[#3c5a5d]" />
          <div className="absolute inset-0 bg-[linear-gradient(115deg,rgba(10,17,19,0.72),rgba(10,17,19,0.08)_52%,rgba(10,17,19,0.38))]" />
          <div className="absolute inset-x-10 bottom-10 h-px bg-white/35 xl:inset-x-14 xl:bottom-14" />
        </section>

        <section className="relative flex min-h-[calc(100vh-1.5rem)] flex-col justify-between bg-[#faf9f7] px-6 py-7 sm:min-h-[calc(100vh-2.5rem)] sm:px-10 sm:py-9 lg:px-14 xl:px-20">
          <div className="size-5 bg-zinc-900 [clip-path:polygon(0_0,100%_0,100%_66%,66%_66%,66%_100%,0_100%)]" />

          <div className="mx-auto w-full max-w-sm py-16 lg:py-0">
            <div className="mb-9 h-px w-12 bg-zinc-900" />
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-900 sm:text-4xl">商品图片工作台</h1>
            <form className="mt-10 space-y-3" onSubmit={onSubmit}>
              <Input
                aria-label="密码"
                autoFocus
                autoComplete="current-password"
                className="h-11 rounded-none border-zinc-300 bg-transparent px-0 text-base shadow-none focus-visible:border-zinc-900 focus-visible:ring-0"
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
              <Button className="mt-3 h-11 w-full rounded-none bg-zinc-900 text-sm hover:bg-zinc-700" size="lg" type="submit" disabled={submitting}>
                {submitting ? "登录中…" : "登录"}
              </Button>
            </form>
          </div>

          <div className="border-t border-zinc-200" />
        </section>
      </div>
    </main>
  );
}
