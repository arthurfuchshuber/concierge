import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

async function clearInvalidSession() {
  try {
    await supabase.auth.signOut();
  } catch {
    // If the auth client/storage is already in a bad state, still redirect below.
  }
}

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    let hasSession = false;

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      hasSession = !!sessionData.session;
    } catch {
      await clearInvalidSession();
      throw redirect({ to: "/auth" });
    }

    if (!hasSession) throw redirect({ to: "/auth" });

    try {
      const { data, error } = await supabase.auth.getUser();
      if (error || !data.user) {
        await clearInvalidSession();
        throw redirect({ to: "/auth" });
      }
      return { user: data.user };
    } catch (error) {
      if (error && typeof error === "object" && "isRedirect" in error) throw error;
      await clearInvalidSession();
      throw redirect({ to: "/auth" });
    }
  },
  component: () => <Outlet />,
});
