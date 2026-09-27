/**
 * The dashboard's actual content now lives in ../../../panels/DashboardPanel.tsx,
 * rendered inside the persistent Workbench dock (see ../layout.tsx). This
 * route is the landing URL after a space is chosen on /spaces — the layout's
 * Workbench opens the dashboard panel by default when there's no saved
 * layout yet, so there's nothing for this page itself to render.
 */
export default function DashboardPage(): null {
  return null;
}
