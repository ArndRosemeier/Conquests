import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./ui/App.tsx";
import "./ui/styles.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Root element #root not found");
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
