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
          <div className="absolute inset-0 bg-[#d8d2c7]" />
          <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(81,75,68,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(81,75,68,0.55)_1px,transparent_1px)] [background-size:68px_68px]" />
          <div className="absolute -left-[18%] top-[16%] h-[56%] w-[70%] rotate-[-15deg] border border-[#514b44]/45" />
          <div className="absolute left-[9%] top-[16%] h-[55%] w-[53%] rotate-[-6deg] bg-[#f8f5ee] shadow-[18px_21px_25px_rgba(78,70,61,0.22)]">
            <div className="absolute inset-5 bg-[linear-gradient(145deg,#d6b28a_0_38%,#c87553_38%_65%,#425d5d_65%)]" />
            <div className="absolute inset-x-5 bottom-5 h-px bg-[#514b44]/30" />
          </div>
          <div className="absolute right-[8%] top-[13%] h-[49%] w-[42%] rotate-[7deg] bg-[#293c40] shadow-[13px_18px_22px_rgba(44,40,35,0.18)]">
            <div className="absolute inset-4 bg-[linear-gradient(135deg,#e7e9df_0_46%,#8da79a_46%_70%,#33494d_70%)]" />
          </div>
          <div className="absolute bottom-[9%] left-[23%] h-[29%] w-[57%] rotate-[2deg] bg-[#b86e4f] shadow-[12px_15px_22px_rgba(78,70,61,0.2)]">
            <div className="absolute inset-0 bg-[linear-gradient(110deg,#273b41_0_34%,#d8a872_34%_63%,#a45c47_63%)]" />
          </div>
          <span className="absolute left-[58%] top-[17%] size-3 rounded-full bg-[#ad4e3e] shadow-[0_2px_3px_rgba(41,37,36,0.38)]" />
          <span className="absolute right-[15%] top-[48%] size-3 rounded-full bg-[#ad4e3e] shadow-[0_2px_3px_rgba(41,37,36,0.38)]" />
          <div className="absolute inset-x-[6%] bottom-8 h-5 border-y border-[#514b44]/60 [background-image:repeating-linear-gradient(90deg,#514b44_0_1px,transparent_1px_20px)] xl:bottom-12" />
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
