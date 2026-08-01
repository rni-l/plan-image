import { jsx as _jsx } from "react/jsx-runtime";
import { createBrowserRouter, Navigate } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell.js";
import { ProductsPage } from "./pages/products/ProductsPage.js";
import { ProductWorkbench } from "./pages/products/ProductWorkbench.js";
import { TaskWizard } from "./pages/tasks/TaskWizard.js";
import { TaskCenterPage } from "./pages/task-center/TaskCenterPage.js";
import { SettingsPage } from "./pages/settings/SettingsPage.js";
import { LogsPage } from "./pages/logs/LogsPage.js";
import { BillingPage } from "./pages/billing/BillingPage.js";
export const router = createBrowserRouter([
    {
        path: "/",
        element: _jsx(AppShell, {}),
        children: [
            { index: true, element: _jsx(Navigate, { to: "/products", replace: true }) },
            // Products
            { path: "products", element: _jsx(ProductsPage, {}) },
            {
                path: "products/:productId",
                element: _jsx(Navigate, { to: "info", replace: true }),
            },
            {
                path: "products/:productId/:tab",
                element: _jsx(ProductWorkbench, {}),
            },
            // Task wizard
            { path: "tasks/:taskId/step/:step", element: _jsx(TaskWizard, {}) },
            // Task centre
            { path: "task-center", element: _jsx(TaskCenterPage, {}) },
            // Logs & Billing
            { path: "logs", element: _jsx(LogsPage, {}) },
            { path: "billing", element: _jsx(BillingPage, {}) },
            // Settings
            { path: "settings", element: _jsx(Navigate, { to: "/settings/models", replace: true }) },
            { path: "settings/:section", element: _jsx(SettingsPage, {}) },
        ],
    },
]);
