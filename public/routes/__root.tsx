import * as React from "react";
import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";
import { GitPullRequest, Settings, LayoutDashboard } from "lucide-react";

function RootLayout() {
  return (
    <div className="flex h-screen">
      <aside className="w-56 border-r border-zinc-800 bg-zinc-900/30 flex flex-col">
        <div className="p-4 border-b border-zinc-800">
          <Link to="/" className="text-lg font-bold tracking-tight">
            fouine
          </Link>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          <NavLink to="/" label="Repositories" icon={<LayoutDashboard size={16} />} />
          <NavLink to="/reviews" label="Reviews" icon={<GitPullRequest size={16} />} />
          <NavLink to="/settings" label="Settings" icon={<Settings size={16} />} />
        </nav>
      </aside>
      <main className="flex-1 overflow-auto p-6">
        <Outlet />
      </main>
    </div>
  );
}

function NavLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors [&.active]:text-zinc-100 [&.active]:bg-zinc-800"
    >
      {icon}
      {label}
    </Link>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

import ReposPage from "./index";
import RepoDetailPage from "./repo-detail";
import ReviewsPage from "./reviews";
import SettingsPage from "./settings";

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: ReposPage,
});
const repoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos/$owner/$name",
  component: RepoDetailPage,
});
const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews",
  component: ReviewsPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  repoRoute,
  reviewsRoute,
  settingsRoute,
]);
