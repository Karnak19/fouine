import * as React from "react";
import { createAuthClient } from "better-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import * as stylex from "@stylexjs/stylex";
import { Button } from "@/components/ui/button";
import { color, leading, radius, space, text, tracking } from "@/tokens.stylex";
import { shared } from "@/styles";

// Same-origin: the client defaults to `${location.origin}/api/auth`.
export const authClient = createAuthClient();

type AuthState = { enabled: boolean; user: { name?: string; image?: string | null } | null };
const AuthContext = React.createContext<AuthState>({ enabled: false, user: null });
export const useAuth = () => React.useContext(AuthContext);

export function signOut() {
  return authClient.signOut().then(() => location.reload());
}

const s = stylex.create({
  screen: {
    display: "flex",
    height: "100vh",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.x24,
    backgroundColor: color.zinc950,
    color: color.zinc100
  },
  brandMark: {
    display: "grid",
    placeItems: "center",
    height: space.x36,
    width: space.x36,
    borderRadius: radius.md,
    backgroundColor: color.ember500,
    color: color.zinc950
  },
  brandText: { fontSize: text.xl, lineHeight: leading.xl, fontWeight: 700, letterSpacing: tracking.tight }
});

function LoginScreen() {
  const [pending, setPending] = React.useState(false);
  return (
    <div {...stylex.props(s.screen)}>
      <span {...stylex.props(shared.row)}>
        <span {...stylex.props(s.brandMark)}>
          <Search size={18} strokeWidth={2.5} />
        </span>
        <span {...stylex.props(s.brandText)}>fouine</span>
      </span>
      <p {...stylex.props(shared.meta)}>Sign in to continue</p>
      <Button
        disabled={pending}
        onClick={() => {
          setPending(true);
          authClient.signIn.social({ provider: "github", callbackURL: "/" });
        }}
      >
        {pending ? "Redirecting…" : "Sign in with GitHub"}
      </Button>
    </div>
  );
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  // Whether login is required at all (server-side toggle). Cheap, cached forever.
  const { data: status, isPending: statusPending } = useQuery({
    queryKey: ["auth-status"],
    queryFn: () => fetch("/api/auth-status").then((r) => r.json() as Promise<{ enabled: boolean }>),
    staleTime: Infinity
  });
  const session = authClient.useSession();

  if (statusPending) return null;
  if (!status?.enabled) {
    return <AuthContext value={{ enabled: false, user: null }}>{children}</AuthContext>;
  }
  if (session.isPending) return null;
  if (!session.data) return <LoginScreen />;
  return (
    <AuthContext value={{ enabled: true, user: session.data.user }}>{children}</AuthContext>
  );
}
