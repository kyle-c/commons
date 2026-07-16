import { contextBridge, ipcRenderer } from "electron";
import type {
  AgentSessionEvent,
  AuthCallback,
  CommonsApi,
  DeepLink,
  DevServerStatus,
  UpdateStatus,
} from "@commons/shared";

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
  getGitStatus: (repoPath) => ipcRenderer.invoke("git-status", repoPath),
  pullRepo: (repoPath) => ipcRenderer.invoke("git-pull", repoPath),
  cloneRepo: (gitRemote, suggestedName) => ipcRenderer.invoke("clone-repo", gitRemote, suggestedName),
  checkGitSetup: (probeRemote) => ipcRenderer.invoke("git-setup-check", probeRemote),
  setGitIdentity: (name, email) => ipcRenderer.invoke("git-set-identity", name, email),
  startAgentSession: (options) => ipcRenderer.invoke("agent-start", options),
  sendAgentPrompt: (sessionId, prompt) => ipcRenderer.invoke("agent-prompt", sessionId, prompt),
  stopAgentSession: (sessionId) => ipcRenderer.invoke("agent-stop", sessionId),
  listAgentSessions: () => ipcRenderer.invoke("agent-list"),
  onAgentEvent: (cb) => {
    const handler = (_e: unknown, sessionId: string, event: AgentSessionEvent) => cb(sessionId, event);
    ipcRenderer.on("agent-event", handler);
    return () => ipcRenderer.removeListener("agent-event", handler);
  },
  captureSnapshot: (url, opts) => ipcRenderer.invoke("capture-snapshot", url, opts),
  getUpdateStatus: () => ipcRenderer.invoke("get-update-status"),
  onUpdateStatus: (cb) => {
    const handler = (_e: unknown, status: UpdateStatus) => cb(status);
    ipcRenderer.on("update-status", handler);
    return () => ipcRenderer.removeListener("update-status", handler);
  },
  installUpdate: () => ipcRenderer.invoke("install-update"),
};

contextBridge.exposeInMainWorld("commons", api);
