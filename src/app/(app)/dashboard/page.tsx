import { Dashboard } from "@/components/dashboard/Dashboard";

// Client-rendered behind the auth gate in the layout, so there is no static
// shell to prerender for instant navigation.
export const instant = false;

export default function DashboardPage() {
  return <Dashboard />;
}
