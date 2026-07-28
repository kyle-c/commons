import React from "react";
import ReactDOM from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import App from "./App";
import SetupScreen from "./views/SetupScreen";
import ErrorBoundary from "./ErrorBoundary";
import { getConvexUrl } from "./lib/session";
import { initErrorReporting } from "./lib/errorReport";
import { initTheme } from "./lib/theme";
import faviconUrl from "./assets/favicon.png";
import "./theme.css";
import "./styles.css";

// Favicon through the bundler so the hashed asset ships identically to the
// desktop build and the /app web deployment (which uploads assets/*).
{
  const link = document.createElement("link");
  link.rel = "icon";
  link.type = "image/png";
  link.href = faviconUrl;
  document.head.appendChild(link);
}

// Only the desktop window has macOS traffic lights to clear; in the browser
// that reserved inset would push the tab strip out of line with the subnav.
document.documentElement.dataset.desktop = window.commons ? "1" : "0";

initTheme();
initErrorReporting();

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
      <ErrorBoundary>
        <ConvexProvider client={client}>
          <App />
        </ConvexProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
