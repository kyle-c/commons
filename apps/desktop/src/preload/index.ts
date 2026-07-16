import { contextBridge, ipcRenderer } from "electron";
import type { AgentSessionEvent, AuthCallback, CommonsApi, DeepLink, DevServerStatus } from "@commons/shared";

const api: CommonsApi = {
  pickRepo: () => ipcRenderer.invoke("pick-repo"),
  inspectRepo: (repoPath) => ipcRenderer.invoke("inspect-repo", repoPath),
  startDevServer: (repoPath) => ipcRenderer.invoke("start-dev-server", repoPath),
  stopDevServer: (repoPath) => ipcRenderer.invoke("stop-dev-server", repoPath),
  getDevServerStatus: (repoPath) => ipcRenderer.invoke("get-dev-server-status", repoPath),
  onDevServerStatus: (cb) => {
    const handler = (_e: unknown, repoPath: string, status: DevServerStatus) => cb(repoPath, status);
    ipcRenderer.on("dev-server-status", handler);
    return () => ipcRenderer.removeListener("dev-server-status", handler);
  },
  onDeepLink: (cb) => {
    const handler = (_e: unknown, link: DeepLink) => cb(link);
    ipcRenderer.on("deep-link", handler);
    return () => ipcRenderer.removeListener("deep-link", handler);
  },
  onAuthCallback: (cb) => {
    const handler = (_e: unknown, auth: AuthCallback) => cb(auth);
    ipcRenderer.on("auth-callback", handler);
    return () => ipcRenderer.removeListener("auth-callback", handler);
  },
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  wrapPreviewUrl: (url, opts) => ipcRenderer.invoke("wrap-preview-url", url, opts),
  startAgentSession: (options) => ipcRenderer.invoke("agent-start", options),
  sendAgentPrompt: (sessionId, prompt) => ipcRenderer.invoke("agent-prompt", sessionId, prompt),
  stopAgentSession: (sessionId) => ipcRenderer.invoke("agent-stop", sessionId),
  listAgentSessions: () => ipcRenderer.invoke("agent-list"),
  onAgentEvent: (cb) => {
    const handler = (_e: unknown, sessionId: string, event: AgentSessionEvent) => cb(sessionId, event);
    ipcRenderer.on("agent-event", handler);
    return () => ipcRenderer.removeListener("agent-event", handler);
  },
};

contextBridge.exposeInMainWorld("commons", api);
