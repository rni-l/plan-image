import { Outlet } from "react-router-dom";
import { Sidebar } from "./Sidebar.js";

export function AppShell() {
  return (
    <div className="flex h-screen overflow-hidden bg-white">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
