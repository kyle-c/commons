/** Recently opened projects (per machine) — feeds the titlebar switcher. */
const KEY = "commons.recentProjects";

export interface RecentProject {
  id: string;
  name: string;
}

export function getRecents(): RecentProject[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((r) => r?.id && r?.name) : [];
  } catch {
    return [];
  }
}

export function pushRecent(id: string, name: string): void {
  const next = [{ id, name }, ...getRecents().filter((r) => r.id !== id)].slice(0, 6);
  localStorage.setItem(KEY, JSON.stringify(next));
}
