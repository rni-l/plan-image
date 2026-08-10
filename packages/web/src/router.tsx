import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell.js";
import { ProductsPage } from "./pages/products/ProductsPage.js";
import { ProductWorkbench } from "./pages/products/ProductWorkbench.js";
import { TaskWizard } from "./pages/tasks/TaskWizard.js";
import { TaskCenterPage } from "./pages/task-center/TaskCenterPage.js";
import { SettingsPage } from "./pages/settings/SettingsPage.js";
import { LogsPage } from "./pages/logs/LogsPage.js";
import { BillingPage } from "./pages/billing/BillingPage.js";
import { PromptTemplatesPage } from "./pages/prompts/PromptTemplatesPage.js";
import { GuidePage } from "./pages/guide/GuidePage.js";
import { LoginPage } from "./pages/auth/LoginPage.js";
import { AuthGate } from "./components/auth/AuthGate.js";

export const router = createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    element: <AuthGate />,
    children: [
      {
        path: "/",
        element: <AppShell />,
        children: [
          { index: true, element: <Navigate to="/products" replace /> },

          // Products
          { path: "products", element: <ProductsPage /> },
          {
            path: "products/:productId",
            element: <Navigate to="info" replace />,
          },
          {
            path: "products/:productId/:tab",
            element: <ProductWorkbench />,
          },

          // Task wizard
          { path: "tasks/:taskId/step/:step", element: <TaskWizard /> },

          // Task centre
          { path: "task-center", element: <TaskCenterPage /> },

          // Logs & Billing
          { path: "logs", element: <LogsPage /> },
          { path: "billing", element: <BillingPage /> },
          { path: "prompts", element: <PromptTemplatesPage /> },
          { path: "guide", element: <GuidePage /> },

          // Settings
          { path: "settings", element: <Navigate to="/settings/models" replace /> },
          { path: "settings/:section", element: <SettingsPage /> },
        ],
      },
    ],
  },
]);
