import * as React from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  GitPullRequest,
  Settings,
  LayoutDashboard,
  FolderGit2,
  ChartNoAxesColumn,
  MessageSquare,
  Copy,
} from "lucide-react";
import { api } from "@/lib/api";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";

const PAGES = [
  { to: "/", label: "Dashboard", icon: <LayoutDashboard /> },
  { to: "/repos", label: "Repositories", icon: <FolderGit2 /> },
  { to: "/reviews", label: "Reviews", icon: <GitPullRequest /> },
  { to: "/stats", label: "Stats", icon: <ChartNoAxesColumn /> },
  { to: "/chat", label: "Chat", icon: <MessageSquare /> },
  { to: "/settings", label: "Settings", icon: <Settings /> },
];

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  const { data: repos } = useQuery({ queryKey: ["repos"], queryFn: api.repos.list });

  const isReviewId = /^\d+$/.test(query.trim());
  const showRecentReviews = query.trim().length >= 2;
  const { data: reviews } = useQuery({
    queryKey: ["reviews", { limit: 200 }],
    queryFn: () => api.reviews.query({ limit: 200 }),
    enabled: open && showRecentReviews,
  });

  const matchingReviews = React.useMemo(() => {
    if (!reviews || !showRecentReviews) return [];
    const q = query.trim().toLowerCase();
    return reviews
      .filter(
        (r) =>
          (r.title ?? "").toLowerCase().includes(q) ||
          r.repo_full_name.toLowerCase().includes(q),
      )
      .slice(0, 8);
  }, [reviews, showRecentReviews, query]);

  function go(to: string, params?: Record<string, string>) {
    onOpenChange(false);
    navigate({ to, params } as never);
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search pages, repos, reviews…" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        <CommandGroup heading="Pages">
          {PAGES.map((p) => (
            <CommandItem key={p.to} value={p.label} onSelect={() => go(p.to)}>
              {p.icon}
              {p.label}
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Repositories">
          {repos?.map((r) => {
            const [owner, name] = r.full_name.split("/");
            return (
              <CommandItem
                key={r.full_name}
                value={r.full_name}
                onSelect={() => go("/repos/$owner/$name", { owner, name })}
              >
                <FolderGit2 />
                {r.full_name}
              </CommandItem>
            );
          })}
        </CommandGroup>
        <CommandGroup heading="Reviews">
          {isReviewId && (
            <CommandItem
              value={`open review ${query.trim()}`}
              onSelect={() => go("/reviews/$id", { id: query.trim() })}
            >
              <GitPullRequest />
              Open review #{query.trim()}
            </CommandItem>
          )}
          {matchingReviews.map((r) => (
            <CommandItem
              key={r.id}
              value={`review ${r.id} ${r.title ?? ""} ${r.repo_full_name}`}
              onSelect={() => go("/reviews/$id", { id: String(r.id) })}
            >
              <GitPullRequest />
              <span className="truncate">
                {r.title ?? `Review #${r.id}`}
                <span className="ml-2 text-xs text-muted-foreground">{r.repo_full_name}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem
            value="copy current url"
            onSelect={() => {
              void navigator.clipboard.writeText(window.location.href);
              onOpenChange(false);
            }}
          >
            <Copy />
            Copy current URL
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
