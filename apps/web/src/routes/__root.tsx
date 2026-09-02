import * as React from "react";
import {
  createRootRoute,
  createRoute,
  Link,
  Outlet,
  useRouterState
} from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import {
  GitPullRequest,
  Settings,
  LayoutDashboard,
  Search,
  FolderGit2,
  Download,
  LogOut,
  ChartNoAxesColumn,
  MessageSquare
} from "lucide-react";
import { color, leading, radius, space, text, tracking } from "@/tokens.stylex";
import { useAuth, signOut } from "../lib/auth";

const s = stylex.create({
  // Shared by the two sidebar footer buttons.
  sideButton: {
    margin: space.x8,
    display: "flex",
    alignItems: "center",
    gap: space.x10,
    borderRadius: radius.md,
    paddingInline: space.x12,
    paddingBlock: space.x8,
    fontSize: text.sm, lineHeight: leading.sm,
    transitionProperty: "color, background-color",
    transitionDuration: "150ms",
    color: { default: color.zinc400, ":hover": color.zinc100 },
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.zinc800} 60%, transparent)`
    }
  },
  avatar: { height: space.x16, width: space.x16, borderRadius: radius.full },
  truncate: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  pushRight: { marginLeft: "auto" },

  logo: { display: "flex", alignItems: "center", gap: space.x8 },
  logoMark: {
    display: "grid",
    placeItems: "center",
    height: space.x28,
    width: space.x28,
    borderRadius: radius.md,
    backgroundColor: color.ember500,
    color: color.zinc950
  },
  logoText: { fontSize: text.base, lineHeight: leading.base, fontWeight: 700, letterSpacing: tracking.tight },

  shell: { display: "flex", height: "100vh" },
  aside: {
    display: { default: "none", "@media (min-width: 768px)": "flex" },
    flexDirection: "column",
    width: space.x224,
    flexShrink: 0,
    borderRightWidth: "1px",
    borderRightStyle: "solid",
    borderRightColor: `color-mix(in oklab, ${color.zinc800} 80%, transparent)`,
    backgroundColor: color.zinc950
  },
  asideHead: {
    paddingInline: space.x16,
    height: space.x56,
    display: "flex",
    alignItems: "center",
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in oklab, ${color.zinc800} 80%, transparent)`
  },
  // `space-y-0.5` is a `& > * + *` margin rule StyleX cannot express; a column
  // flex with the same gap renders identically for these block-level links.
  navList: {
    flexGrow: 1,
    flexBasis: 0,
    padding: space.x8,
    display: "flex",
    flexDirection: "column",
    gap: space.x2
  },
  main: {
    flexGrow: 1,
    flexBasis: 0,
    overflow: "auto",
    display: "flex",
    flexDirection: "column"
  },
  header: {
    display: { default: "flex", "@media (min-width: 768px)": "none" },
    alignItems: "center",
    justifyContent: "space-between",
    paddingInline: space.x16,
    height: space.x56,
    borderBottomWidth: "1px",
    borderBottomStyle: "solid",
    borderBottomColor: `color-mix(in oklab, ${color.zinc800} 80%, transparent)`,
    backgroundColor: color.zinc950,
    flexShrink: 0
  },
  tabBar: {
    display: { default: "grid", "@media (min-width: 768px)": "none" },
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 10,
    gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
    borderTopWidth: "1px",
    borderTopStyle: "solid",
    borderTopColor: `color-mix(in oklab, ${color.zinc800} 80%, transparent)`,
    backgroundColor: `color-mix(in oklab, ${color.zinc950} 95%, transparent)`,
    backdropFilter: "blur(8px)",
    paddingBottom: "env(safe-area-inset-bottom)"
  },

  link: {
    display: "flex",
    alignItems: "center",
    gap: space.x10,
    borderRadius: radius.md,
    paddingInline: space.x12,
    paddingBlock: space.x8,
    fontSize: text.sm, lineHeight: leading.sm,
    transitionProperty: "color, background-color",
    transitionDuration: "150ms",
    color: { default: color.zinc400, ":hover": color.zinc100 },
    backgroundColor: {
      default: null,
      ":hover": `color-mix(in oklab, ${color.zinc800} 60%, transparent)`
    }
  },
  // The active colours also restate `:hover`, because the old `[&.active]`
  // variant outranked `hover:` — an active link stays ember while hovered.
  linkActive: {
    color: { default: color.ember300, ":hover": color.ember300 },
    backgroundColor: {
      default: `color-mix(in oklab, ${color.ember950} 40%, transparent)`,
      ":hover": `color-mix(in oklab, ${color.ember950} 40%, transparent)`
    }
  },
  tab: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x4,
    paddingBlock: space.x10,
    minHeight: space.x56,
    fontSize: text.xxxs,
    fontWeight: 500,
    transitionProperty: "color",
    transitionDuration: "150ms",
    color: color.zinc500
  },
  tabActive: { color: color.ember300 },

  content: {
    marginInline: "auto",
    width: "100%",
    maxWidth: space.x1280,
    paddingInline: { default: space.x16, "@media (min-width: 768px)": space.x32 },
    paddingTop: { default: space.x24, "@media (min-width: 768px)": space.x32 }
  },
  contentFullHeight: {
    display: "flex",
    minHeight: 0,
    flexGrow: 1,
    flexBasis: 0,
    flexDirection: "column",
    paddingBottom: {
      default: `calc(${space.x56} + env(safe-area-inset-bottom))`,
      "@media (min-width: 768px)": space.x32
    }
  },
  contentBlock: {
    paddingBottom: { default: space.x96, "@media (min-width: 768px)": space.x32 }
  }
});

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
      {...stylex.props(s.sideButton)}
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
      {...stylex.props(s.sideButton)}
    >
      {user.image && <img src={user.image} alt="" {...stylex.props(s.avatar)} />}
      <span {...stylex.props(s.truncate)}>{user.name ?? "Sign out"}</span>
      <LogOut size={14} {...stylex.props(s.pushRight)} />
    </button>
  );
}

function Logo() {
  return (
    <span {...stylex.props(s.logo)}>
      <span {...stylex.props(s.logoMark)}>
        <Search size={15} strokeWidth={2.5} />
      </span>
      <span {...stylex.props(s.logoText)}>fouine</span>
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
// sticks to its bottom, so this box must have a *bounded* height for `height:
// 100%` inside it to mean anything (flex-grow with min-height 0). The tab-bar
// clearance then has to be exactly the bar's height — padding here shrinks the
// box rather than trailing the content, so the roomy 6rem would leave a dead
// gap above the bar instead of breathing room under the last message.
//
// Making every route grow-with-min-height-0 would look tidier but quietly
// breaks the long pages: their overflow escapes the box, so the 6rem bottom
// padding would end up floating mid-page and content would run under the tab bar.
function contentLayout(fullHeight: boolean) {
  return fullHeight ? s.contentFullHeight : s.contentBlock;
}

function RootLayout() {
  const pathname = useRouterState({ select: (st) => st.location.pathname });
  const isFullHeight = FULL_HEIGHT_ROUTES.includes(pathname);

  return (
    <div {...stylex.props(s.shell)}>
      {/* Desktop: left sidebar. Hidden on mobile in favour of the bottom tab bar. */}
      <aside {...stylex.props(s.aside)}>
        <div {...stylex.props(s.asideHead)}>
          <Logo />
        </div>
        <nav {...stylex.props(s.navList)}>
          {NAV.map((n) => (
            <NavLink key={n.to} {...n} />
          ))}
        </nav>
        <InstallButton />
        <UserMenu />
      </aside>
      <main {...stylex.props(s.main)}>
        {/* Mobile: top header with brand + install action. */}
        <header {...stylex.props(s.header)}>
          <Logo />
          <InstallButton />
        </header>
        <div {...stylex.props(s.content, contentLayout(isFullHeight))}>
          <Outlet />
        </div>
      </main>
      {/* Mobile: bottom tab bar with safe-area padding for the home indicator. */}
      <nav {...stylex.props(s.tabBar)}>
        {NAV.map((n) => (
          <TabLink key={n.to} {...n} />
        ))}
      </nav>
    </div>
  );
}

// The active state is the router's own test, via activeProps/inactiveProps.
// Each state passes ONE complete stylex.props call — Link concatenates the two
// classNames and only one of them is ever non-empty, so StyleX's own conflict
// resolution still decides which declaration wins.
function NavLink({ to, label, icon }: { to: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      to={to}
      activeProps={stylex.props(s.link, s.linkActive)}
      inactiveProps={stylex.props(s.link)}
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
      activeProps={stylex.props(s.tab, s.tabActive)}
      inactiveProps={stylex.props(s.tab)}
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
  component: DashboardPage
});
const reposRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos",
  component: ReposPage
});
const repoRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos/$owner/$name",
  component: RepoDetailPage
});
const prRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/repos/$owner/$name/pr/$number",
  component: PRDetailPage
});
const reviewsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews",
  component: ReviewsPage
});
const reviewDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/reviews/$id",
  component: ReviewDetailPage
});
const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/stats",
  component: StatsPage,
  validateSearch: validateStatsSearch
});
// No validateSearch: this page is deliberately not filter-driven.
const chatRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/chat",
  component: ChatPage
});
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage
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
