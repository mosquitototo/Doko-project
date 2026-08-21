import { Navigate, Outlet, useLocation } from "react-router-dom";
import { lazy, Suspense, useEffect, useCallback, useState } from "react";
import { fetchMe, type Me } from "../../api/me";
import Sidebar from "./Sidebar";
import { MeContext } from "../../contexts/MeContext";
import { ThemeProvider } from "../theme/ThemeProvider";

const GlobalChatDrawer = lazy(() => import("../../components/chat/GlobalChatDrawer"));

function ShellLayout() {
  const [me, setMe] = useState<Me | null>(null);
  const [loading, setLoading] = useState(true);
  const [authFailed, setAuthFailed] = useState(false);
  const location = useLocation();
  const [chatOpen, setChatOpen] = useState(false);
  const [chatLoaded, setChatLoaded] = useState(false);

  const hideChat =
    location.pathname.startsWith("/login") ||
    location.pathname.startsWith("/setup");

  const canUseChat =
    !!me?.is_admin || !!me?.permissions?.includes("chat.use");

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
              setChatLoaded(true);
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

          {!hideChat && canUseChat && chatLoaded ? (
            <Suspense fallback={null}>
              <GlobalChatDrawer
                open={chatOpen}
                onClose={() => setChatOpen(false)}
              />
            </Suspense>
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
