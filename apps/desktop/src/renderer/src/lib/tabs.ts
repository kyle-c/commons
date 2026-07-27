/**
 * Open-project tabs (Figma-style): navigation state only. The active tab
 * mounts; background tabs are just entries, so no extra subscriptions,
 * heartbeats, or iframes ride along. Persisted per machine.
 */
export interface ProjectTab {
  id: string;
  name: string;
}

const KEY = "commons.openTabs";

export function loadTabs(): { tabs: ProjectTab[]; active: string } {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "");
    const tabs = Array.isArray(parsed?.tabs)
      ? parsed.tabs.filter((t: ProjectTab) => t?.id && typeof t.name === "string")
      : [];
    const active =
      parsed?.active === "home" || tabs.some((t: ProjectTab) => t.id === parsed?.active)
        ? parsed.active
        : "home";
    return { tabs, active };
  } catch {
    return { tabs: [], active: "home" };
  }
}

export function saveTabs(tabs: ProjectTab[], active: string): void {
  localStorage.setItem(KEY, JSON.stringify({ tabs, active }));
}
