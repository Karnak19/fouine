import * as React from "react";
import { createAuthClient } from "better-auth/react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";

// Same-origin: the client defaults to `${location.origin}/api/auth`.
export const authClient = createAuthClient();

type AuthState = { enabled: boolean; user: { name?: string; image?: string | null } | null };
const AuthContext = React.createContext<AuthState>({ enabled: false, user: null });
export const useAuth = () => React.useContext(AuthContext);

export function signOut() {
  return authClient.signOut().then(() => location.reload());
}

function LoginScreen() {
  const [pending, setPending] = React.useState(false);
  return (
    <div className="flex h-screen flex-col items-center justify-center gap-6 bg-zinc-950 text-zinc-100">
      <span className="flex items-center gap-2">
        <span className="grid place-items-center h-9 w-9 rounded-md bg-ember-500 text-zinc-950">
          <Search size={18} strokeWidth={2.5} />
        </span>
        <span className="text-xl font-bold tracking-tight">fouine</span>
      </span>
      <p className="text-sm text-zinc-400">Sign in to continue</p>
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
    staleTime: Infinity,
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
