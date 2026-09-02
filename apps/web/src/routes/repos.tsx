import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import * as stylex from "@stylexjs/stylex";
import { api, type RepoRow } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Plus, ChevronRight, FolderGit2 } from "lucide-react";
import { useLiveEvents } from "@/lib/live";
import { LiveBadge } from "@/components/live-badge";
import { timeAgo } from "@/lib/format";
import { color, font, leading, radius, space, text, tracking } from "@/tokens.stylex";

// Tailwind's `animate-pulse`. Restated locally because the @keyframes only
// exist while a className references the utility.
const pulse = stylex.keyframes({ "50%": { opacity: 0.5 } });

const s = stylex.create({
  // `space-y-*` is a margin-bottom-on-all-but-last rule StyleX cannot express;
  // a column flex with the same gap renders identically for these block-level
  // children. NOT so when a child is inline (see `field`): a flex item is
  // blockified.
  page: { display: "flex", flexDirection: "column", gap: space.x24, maxWidth: space.x896 },
  titleRow: { display: "flex", alignItems: "center", gap: space.x8 },
  title: { fontSize: text.xl2, lineHeight: leading.xl2, fontWeight: 700, letterSpacing: tracking.tight },
  subtitle: { fontSize: text.sm, lineHeight: leading.sm, color: color.zinc500, marginTop: space.x4 },

  form: { display: "flex", alignItems: "flex-end", gap: space.x16 },
  // Plain block, not a column flex: blockifying the inline <label> would make
  // it full-width and 3px shorter. The label + control need no gap between
  // them — Tailwind's `space-y-1.5` margin-bottom was ignored on the inline
  // label, and these fields have no third child.
  field: {
    display: "block",
    flexGrow: 1,
    flexBasis: 0
  },
  fieldNarrow: { display: "block", width: space.x160 },

  skeletonList: { display: "flex", flexDirection: "column", gap: space.x8 },
  skeletonRow: {
    height: space.x48,
    borderRadius: radius.md,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 60%, transparent)`,
    animationName: pulse,
    animationDuration: "2s",
    animationTimingFunction: "cubic-bezier(0.4, 0, 0.6, 1)",
    animationIterationCount: "infinite"
  },

  empty: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "dashed",
    borderColor: color.zinc800,
    paddingBlock: space.x64,
    textAlign: "center"
  },
  emptyIcon: { color: color.zinc700 },
  emptyTitle: { marginTop: space.x12, fontSize: text.sm, lineHeight: leading.sm, color: color.zinc400 },
  emptyHint: { fontSize: text.xs, lineHeight: leading.xs, color: color.zinc600, marginTop: space.x4 },

  tableWrap: {
    borderRadius: radius.lg,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: color.zinc800,
    backgroundColor: `color-mix(in oklab, ${color.zinc900} 40%, transparent)`,
    overflow: "hidden"
  },
  alignRight: { textAlign: "right" },
  colChevron: { width: space.x32 },

  repoLink: {
    fontFamily: font.mono,
    fontSize: text.sm, lineHeight: leading.sm,
    transitionProperty: "color",
    transitionDuration: "150ms"
  },
  // `hover:text-ember-300` outranked the enabled/disabled colour, so both
  // variants restate the hover value.
  repoLinkOn: { color: { default: color.zinc100, ":hover": color.ember300 } },
  repoLinkOff: { color: { default: color.zinc500, ":hover": color.ember300 } },

  numCell: { color: color.zinc400, fontSize: text.sm, lineHeight: leading.sm, fontVariantNumeric: "tabular-nums" },
  monoCell: { color: color.zinc400, fontSize: text.sm, lineHeight: leading.sm, fontFamily: font.mono },
  timeCell: {
    color: color.zinc500,
    fontSize: text.sm, lineHeight: leading.sm,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums"
  },
  chevronCell: { color: color.zinc600 },
  chevronLink: {
    display: "block",
    transitionProperty: "color",
    transitionDuration: "150ms",
    color: { default: null, ":hover": color.zinc300 }
  },

  switch: {
    position: "relative",
    display: "inline-flex",
    height: space.x20,
    width: space.x36,
    flexShrink: 0,
    alignItems: "center",
    borderRadius: radius.full,
    transitionProperty: "background-color",
    transitionDuration: "150ms",
    cursor: { default: "pointer", ":disabled": "not-allowed" },
    opacity: { default: null, ":disabled": 0.4 },
    outlineStyle: { default: null, ":focus-visible": "none" },
    // `ring-2 ring-primary/50` with `ring-offset-2 ring-offset-background`:
    // the offset ring is the inner shadow, the ring itself the outer one.
    boxShadow: {
      default: null,
      ":focus-visible": `0 0 0 2px ${color.background}, 0 0 0 4px color-mix(in oklab, ${color.primary} 50%, transparent)`
    }
  },
  switchOn: { backgroundColor: color.primary },
  switchOff: { backgroundColor: color.zinc700 },
  knob: {
    display: "inline-block",
    height: space.x14,
    width: space.x14,
    borderRadius: radius.full,
    backgroundColor: color.zinc950,
    transitionProperty: "transform",
    transitionDuration: "150ms"
  },
  knobOn: { transform: "translateX(18px)" },
  knobOff: { transform: "translateX(3px)" }
});

export default function ReposPage() {
  const queryClient = useQueryClient();
  const { data: repos, isLoading } = useQuery({
    queryKey: ["repos"],
    queryFn: api.repos.list
  });

  // Global scope: repo CRUD can happen for any repo, not just one we're viewing.
  const { status, resync } = useLiveEvents(null, (e) => {
    if (e.type === "repo:updated" || e.type === "repo:removed") {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
    }
  });
  useEffect(() => {
    if (resync > 0) queryClient.invalidateQueries({ queryKey: ["repos"] });
  }, [resync, queryClient]);

  const [fullName, setFullName] = useState("");
  const [installId, setInstallId] = useState("");

  const createMut = useMutation({
    mutationFn: () => api.repos.create({ full_name: fullName, installation_id: Number(installId) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["repos"] });
      setFullName("");
      setInstallId("");
    }
  });

  return (
    <div {...stylex.props(s.page)}>
      <div>
        <div {...stylex.props(s.titleRow)}>
          <h1 {...stylex.props(s.title)}>Repositories</h1>
          <LiveBadge status={status} />
        </div>
        <p {...stylex.props(s.subtitle)}>Repos fouine watches for pull requests.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Register repository</CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMut.mutate();
            }}
            {...stylex.props(s.form)}
          >
            <div {...stylex.props(s.field)}>
              <Label htmlFor="full_name">Full name (owner/repo)</Label>
              <Input
                id="full_name"
                placeholder="acme/widgets"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                pattern="[^/]+/[^/]+"
              />
            </div>
            <div {...stylex.props(s.fieldNarrow)}>
              <Label htmlFor="installation_id">Installation ID</Label>
              <Input
                id="installation_id"
                type="number"
                placeholder="12345678"
                value={installId}
                onChange={(e) => setInstallId(e.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={createMut.isPending}>
              <Plus size={16} />
              Register
            </Button>
          </form>
        </CardContent>
      </Card>

      {isLoading ? (
        <div {...stylex.props(s.skeletonList)}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} {...stylex.props(s.skeletonRow)} />
          ))}
        </div>
      ) : !repos?.length ? (
        <div {...stylex.props(s.empty)}>
          <FolderGit2 size={28} {...stylex.props(s.emptyIcon)} />
          <p {...stylex.props(s.emptyTitle)}>No repositories registered</p>
          <p {...stylex.props(s.emptyHint)}>Add one above to get started.</p>
        </div>
      ) : (
        <div {...stylex.props(s.tableWrap)}>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Repository</TableHead>
                <TableHead>Auto-review</TableHead>
                <TableHead>Installation</TableHead>
                <TableHead>Model</TableHead>
                <TableHead style={s.alignRight}>Registered</TableHead>
                <TableHead style={s.colChevron} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {repos.map((r) => (
                <RepoRow key={r.full_name} repo={r} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function RepoRow({ repo }: { repo: RepoRow }) {
  const [owner, name] = repo.full_name.split("/");
  const queryClient = useQueryClient();
  const enabled = repo.enabled === 1;

  const toggleMut = useMutation({
    // Resend the existing prompt/model — the PUT treats omitted fields as null,
    // so a bare { enabled } would wipe them.
    mutationFn: (next: boolean) =>
      api.repos.update(owner, name, {
        prompt: repo.prompt ?? undefined,
        model: repo.model ?? undefined,
        enabled: next ? 1 : 0
      }),
    onMutate: async (next: boolean) => {
      await queryClient.cancelQueries({ queryKey: ["repos"] });
      const prev = queryClient.getQueryData<RepoRow[]>(["repos"]);
      queryClient.setQueryData<RepoRow[]>(["repos"], (old) =>
        old?.map((r) => (r.full_name === repo.full_name ? { ...r, enabled: next ? 1 : 0 } : r)),
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) queryClient.setQueryData(["repos"], ctx.prev);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ["repos"] })
  });

  return (
    <TableRow>
      <TableCell>
        <Link
          to="/repos/$owner/$name"
          params={{ owner, name }}
          {...stylex.props(s.repoLink, enabled ? s.repoLinkOn : s.repoLinkOff)}
        >
          {repo.full_name}
        </Link>
      </TableCell>
      <TableCell>
        <Switch
          checked={enabled}
          disabled={toggleMut.isPending}
          onChange={(v) => toggleMut.mutate(v)}
          label={`Auto-review ${repo.full_name}`}
        />
      </TableCell>
      <TableCell style={s.numCell}>{repo.installation_id}</TableCell>
      <TableCell style={s.monoCell}>{repo.model ?? "default"}</TableCell>
      <TableCell style={s.timeCell}>{timeAgo(repo.created_at)}</TableCell>
      <TableCell style={s.chevronCell}>
        <Link
          to="/repos/$owner/$name"
          params={{ owner, name }}
          {...stylex.props(s.chevronLink)}
          aria-label={`Open ${repo.full_name}`}
        >
          <ChevronRight size={16} />
        </Link>
      </TableCell>
    </TableRow>
  );
}

function Switch({
  checked,
  onChange,
  disabled,
  label
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      {...stylex.props(s.switch, checked ? s.switchOn : s.switchOff)}
    >
      <span {...stylex.props(s.knob, checked ? s.knobOn : s.knobOff)} />
    </button>
  );
}
