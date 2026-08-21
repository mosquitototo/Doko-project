import { Suspense } from "react";
import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { ToastProvider } from "../components/ui/toast";
import { ThemeProvider } from "../components/theme/ThemeProvider";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <Suspense
          fallback={
            <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
              Loading Doko…
            </div>
          }
        >
          <RouterProvider router={router} />
        </Suspense>
      </ToastProvider>
    </ThemeProvider>
  );
}
