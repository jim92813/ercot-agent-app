import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";

document.body.classList.add("calcite-mode-dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
