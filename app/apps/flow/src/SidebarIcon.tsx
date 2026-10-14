import type { ReactNode } from "react";

const shapes = {
  home: <><path d="m3 11 9-8 9 8" /><path d="M5 10v11h14V10M9 21v-7h6v7" /></>,
  architecture: <><rect x="8" y="3" width="8" height="5" rx="1.5" /><path d="M12 8v5M5 16v-3h14v3" /><rect x="2" y="16" width="6" height="5" rx="1.5" /><rect x="16" y="16" width="6" height="5" rx="1.5" /></>,
  files: <path d="M3 7V6a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z" />,
  plan: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  graph: <><path d="m8.5 6.5 6-1M8 9l7 7M6 9.5v6M8.5 18h6" /><circle cx="6" cy="7" r="2.5" /><circle cx="17" cy="5" r="2.5" /><circle cx="6" cy="18" r="2.5" /><circle cx="17" cy="18" r="2.5" /></>,
  docs: <><path d="M9 21H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h8l5 5v3M14 3v5h5" /><circle cx="14" cy="15" r="4" /><path d="m17 18 4 4" /></>,
  log: <><rect x="5" y="3" width="14" height="18" rx="2" /><path d="m8 8 1 1 2-2M13 8h3M8 13h8M8 17h5" /></>,
  more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  chat: <><path d="M5 4h14a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V5a1 1 0 0 1 1-1Z" /><path d="M8 9h8" /></>,
  add: <path d="M12 4v16M4 12h16" />,
} satisfies Record<string, ReactNode>;

export type SidebarIconName = keyof typeof shapes;
export function SidebarIcon({ name }: { name: SidebarIconName }) {
  return <svg className="sidebar-icon" viewBox="0 0 24 24" aria-hidden="true">{shapes[name]}</svg>;
}
