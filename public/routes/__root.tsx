import * as React from "react";
import { createRootRoute, createRoute, Link, Outlet } from "@tanstack/react-router";
import { GitPullRequest, Settings, LayoutDashboard, Search, FolderGit2 } from "lucide-react";

function RootLayout() {
  return (
    <div className="flex h-screen">
      <aside className="w-56 shrink-0 border-r border-zinc-800/80 bg-zinc-950 flex flex-col">
        <div className="flex items-center gap-2 px-4 h-14 border-b border-zinc-800/80">
          <span className="grid place-items-center h-7 w-7 rounded-md bg-zinc-100 text-zinc-900">
            <Search size={15} strokeWidth={2.5} />
          </span>
          <span className="text-base font-bold tracking-tight">fouine</span>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          <NavLink to="/" label="Dashboard" icon={<LayoutDashboard size={16} />} />
          <NavLink to="/repos" label="Repositories" icon={<FolderGit2 size={16} />} />
          <NavLink to="/reviews" label="Reviews" icon={<GitPullRequest size={16} />} />
          <NavLink to="/settings" label="Settings" icon={<Settings size={16} />} />
        </nav>
      </aside>
      <main className="flex-1 overflow-auto">
        <div className="mx-auto max-w-5xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function NavLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100 hover:bg-zinc-800/60 [&.active]:text-zinc-100 [&.active]:bg-zinc-800/80 before:absolute before:left-0 before:top-1/2 before:h-4 before:w-0.5 before:-translate-y-1/2 before:rounded-full before:bg-transparent before:transition-colors [&.active]:before:bg-zinc-100"
    >
      {icon}
      {label}
    </Link>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

import ReposPage from "./repos";
import RepoDetailPage from "./repo-detail";
import ReviewsPage from "./reviews";
import ReviewDetailPage from "./review-detail";
import SettingsPage from "./settings";
import DashboardPage from "./dashboard";

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: DashboardPage,
});
const reposRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos",
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
const reviewDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews/$id",
  component: ReviewDetailPage,
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

export const routeTree = rootRoute.addChildren([
  indexRoute,
  reposRoute,
  repoRoute,
  reviewsRoute,
  reviewDetailRoute,
  settingsRoute,
]);
