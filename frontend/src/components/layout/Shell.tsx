import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useEffect, useCallback, useState } from "react";
import { fetchMe, type Me } from "../../api/me";
import Sidebar from "./Sidebar";
import { MeContext } from "../../contexts/MeContext";
import GlobalChatDrawer from "../../components/chat/GlobalChatDrawer";
import { ThemeProvider } from "../theme/ThemeProvider";

function ShellLayout() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);
  const location = useLocation();
  const [chatOpen, setChatOpen] = useState(false);

  const hideChat =
    location.pathname.startsWith("/login") ||
    location.pathname.startsWith("/setup");

  const canUseChat =
    !!me?.is_staff || !!me?.permissions?.includes("chat.use");

  const reloadMe = useCallback(async () => {
    try {
      const next = await fetchMe();
      setMe(next);
      setAuthFailed(false);
    } catch {
      setMe(null);
      setAuthFailed(true);
    }
  }, []);

  useEffect(() => {
    reloadMe().finally(() => setLoading(false));
  }, [reloadMe]);

  if (loading) {
    return <div className="p-4 text-app sm:p-6">Loading…</div>;
  }

  if (authFailed || !me) {
    return <Navigate to="/login" replace />;
  }

  return (
    <MeContext.Provider value={{ me, reloadMe }}>
      <div className="flex h-screen w-full overflow-hidden bg-app text-app">
        <Sidebar
          me={me}
          onOpenGlobalChat={() => {
            if (canUseChat) {
              setChatOpen(true);
            }
          }}
          globalChatOpen={chatOpen}
          globalChatHasActiveRun={false}
        />

        <div className="flex min-w-0 flex-1 flex-col">
          <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto p-3 sm:p-4 lg:p-6">
            <div className="mx-auto w-full max-w-[1800px] min-w-0">
              <Outlet />
            </div>
          </main>

          {!hideChat && canUseChat ? (
            <GlobalChatDrawer
              open={chatOpen}
              onClose={() => setChatOpen(false)}
            />
          ) : null}
        </div>
      </div>
    </MeContext.Provider>
  );
}

export default function Shell() {
  return (
    <ThemeProvider>
      <ShellLayout />
    </ThemeProvider>
  );
}