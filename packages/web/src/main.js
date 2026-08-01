import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { router } from "./router.js";
import { Toaster } from "sonner";
import "./index.css";
ReactDOM.createRoot(document.getElementById("root")).render(_jsxs(React.StrictMode, { children: [_jsx(RouterProvider, { router: router }), _jsx(Toaster, { position: "bottom-right" })] }));
