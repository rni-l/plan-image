import { useEffect, useState } from "react";
import { Navigate, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "@/lib/api.js";

export function AuthGate() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<"checking" | "authenticated" | "unauthenticated">("checking");

  useEffect(() => {
    let disposed = false;
    const loginPath = `${location.pathname}${location.search}`;
    const redirectToLogin = () => {
      if (!disposed) {
        setStatus("unauthenticated");
        navigate("/login", { replace: true, state: { from: loginPath } });
      }
    };

    void api.get<{ expiresAt: string }>("/auth/session")
      .then(() => { if (!disposed) setStatus("authenticated"); })
      .catch(redirectToLogin);
    window.addEventListener("auth:unauthorized", redirectToLogin);

    return () => {
      disposed = true;
      window.removeEventListener("auth:unauthorized", redirectToLogin);
    };
  }, [location.pathname, location.search, navigate]);

  if (status === "checking") {
    return <div className="grid min-h-screen place-items-center text-sm text-zinc-500">正在验证登录状态…</div>;
  }
  if (status === "unauthenticated") return <Navigate to="/login" replace />;
  return <Outlet />;
}
