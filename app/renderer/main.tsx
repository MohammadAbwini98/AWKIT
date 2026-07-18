import React from "react";
import ReactDOM from "react-dom/client";
import { SecurityGate } from "./security/SecurityGate";
import "./styles/global.css";

// The SecurityGate wraps the app: it renders only the sign-in surfaces until the trusted main process
// confirms a session, then mounts <App/>. Protected routes are never mounted before authentication.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <SecurityGate />
  </React.StrictMode>
);
