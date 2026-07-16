import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import SetupScreen from "./views/SetupScreen";
import { getConvexUrl } from "./lib/session";
import { initTheme } from "./lib/theme";
import "./theme.css";
import "./styles.css";

initTheme();

const root = ReactDOM.createRoot(document.getElementById("root")!);
const convexUrl = getConvexUrl();

if (!convexUrl) {
  root.render(
    <React.StrictMode>
      <SetupScreen />
    </React.StrictMode>
  );
} else {
  const client = new ConvexReactClient(convexUrl);
  root.render(
    <React.StrictMode>
      <ConvexProvider client={client}>
        <App />
      </ConvexProvider>
    </React.StrictMode>
  );
}
