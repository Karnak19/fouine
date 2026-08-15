import * as React from "react";
import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";
import {
  GitPullRequest,
  Settings,
  LayoutDashboard,
  Search,
  FolderGit2,
  Download,
  LogOut,
  ChartNoAxesColumn,
  MessageSquare,
} from "lucide-react";
import { useAuth, signOut } from "../lib/auth";

// Captured beforeinstallprompt event, so we can trigger the install from our own button.
type InstallPrompt = Event & { prompt: () => Promise<void> };

function InstallButton() {
  const [prompt, setPrompt] = React.useState<InstallPrompt | null>(null);
  React.useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    addEventListener("beforeinstallprompt", onPrompt);
    addEventListener("appinstalled", () => setPrompt(null));
    return () => removeEventListener("beforeinstallprompt", onPrompt);
  }, []);
  if (!prompt) return null;
  return (
    <button
      type="button"
      onClick={() => {
        void prompt.prompt();
        setPrompt(null);
      }}
      className="m-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100 hover:bg-zinc-800/60"
    >
      <Download size={16} />
      Install app
    </button>
  );
}

const NAV = [
  { to: "/", label: "Dashboard", icon: <LayoutDashboard size={16} /> },
  { to: "/repos", label: "Repositories", icon: <FolderGit2 size={16} /> },
  { to: "/reviews", label: "Reviews", icon: <GitPullRequest size={16} /> },
  { to: "/stats", label: "Stats", icon: <ChartNoAxesColumn size={16} /> },
  { to: "/chat", label: "Chat", icon: <MessageSquare size={16} /> },
  { to: "/settings", label: "Settings", icon: <Settings size={16} /> },
];

function UserMenu() {
  const { enabled, user } = useAuth();
  if (!enabled || !user) return null;
  return (
    <button
      type="button"
      onClick={() => void signOut()}
      title={`Sign out${user.name ? ` (${user.name})` : ""}`}
      className="m-2 flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100 hover:bg-zinc-800/60"
    >
      {user.image && <img src={user.image} alt="" className="h-4 w-4 rounded-full" />}
      <span className="truncate">{user.name ?? "Sign out"}</span>
      <LogOut size={14} className="ml-auto" />
    </button>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid place-items-center h-7 w-7 rounded-md bg-ember-500 text-zinc-950">
        <Search size={15} strokeWidth={2.5} />
      </span>
      <span className="text-base font-bold tracking-tight">fouine</span>
    </span>
  );
}

// Routes that want to own the vertical space themselves instead of being a
// block of content that grows and lets <main> scroll.
const FULL_HEIGHT_ROUTES = ["/chat"];

// Two layouts, deliberately kept apart rather than unified.
//
// Every page except chat is a plain content block: it grows with its content
// and <main> does the scrolling. Its bottom padding has to clear the fixed
// mobile tab bar, which only works because the padding sits at the end of the
// scrolled content.
//
// Chat is the opposite: the thread viewport scrolls internally and the composer
// sticks to its bottom, so this box must have a *bounded* height for `h-full`
// inside it to mean anything (`flex-1 min-h-0`). The tab-bar clearance then has
// to be exactly the bar's height — padding here shrinks the box rather than
// trailing the content, so the roomy `pb-24` would leave a dead gap above the
// bar instead of breathing room under the last message.
//
// Making every route `flex-1 min-h-0` would look tidier but quietly breaks the
// long pages: their overflow escapes the box, so `pb-24` would end up floating
// mid-page and content would run under the tab bar.
function contentClass(fullHeight: boolean) {
  const base = "mx-auto w-full max-w-7xl px-4 py-6 md:px-8 md:py-8";
  return fullHeight
    ? `${base} flex min-h-0 flex-1 flex-col pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-8`
    : `${base} pb-24 md:pb-8`;
}

function RootLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isFullHeight = FULL_HEIGHT_ROUTES.includes(pathname);

  return (
    <div className="flex h-screen">
      {/* Desktop: left sidebar. Hidden on mobile in favour of the bottom tab bar. */}
      <aside className="hidden md:flex w-56 shrink-0 border-r border-zinc-800/80 bg-zinc-950 flex-col">
        <div className="px-4 h-14 flex items-center border-b border-zinc-800/80">
          <Logo />
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {NAV.map((n) => (
            <NavLink key={n.to} {...n} />
          ))}
        </nav>
        <InstallButton />
        <UserMenu />
      </aside>
      <main className="flex-1 overflow-auto flex flex-col">
        {/* Mobile: top header with brand + install action. */}
        <header className="md:hidden flex items-center justify-between px-4 h-14 border-b border-zinc-800/80 bg-zinc-950 shrink-0">
          <Logo />
          <InstallButton />
        </header>
        <div className={contentClass(isFullHeight)}>
          <Outlet />
        </div>
      </main>
      {/* Mobile: bottom tab bar with safe-area padding for the home indicator. */}
      <nav className="md:hidden fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-zinc-800/80 bg-zinc-950/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
        {NAV.map((n) => (
          <TabLink key={n.to} {...n} />
        ))}
      </nav>
    </div>
  );
}

function NavLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-100 hover:bg-zinc-800/60 [&.active]:text-ember-300 [&.active]:bg-ember-950/40"
    >
      {icon}
      {label}
    </Link>
  );
}

function TabLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeOptions={{ exact: to === "/" }}
      className="flex flex-col items-center justify-center gap-1 py-2.5 min-h-14 text-[0.65rem] font-medium text-zinc-500 transition-colors [&.active]:text-ember-300"
    >
      {icon}
      {label}
    </Link>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

import ReposPage from "./repos";
import RepoDetailPage from "./repo-detail";
import PRDetailPage from "./pr-detail";
import ReviewsPage from "./reviews";
import ReviewDetailPage from "./review-detail";
import SettingsPage from "./settings";
import DashboardPage from "./dashboard";
import StatsPage, { validateStatsSearch } from "./stats";
import ChatPage from "./chat";

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
const prRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos/$owner/$name/pr/$number",
  component: PRDetailPage,
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
const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: StatsPage,
  validateSearch: validateStatsSearch,
});
// No validateSearch: this page is deliberately not filter-driven.
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage,
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
  prRoute,
  reviewsRoute,
  reviewDetailRoute,
  statsRoute,
  chatRoute,
  settingsRoute,
]);
