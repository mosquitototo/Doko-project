import { RouterProvider } from "react-router-dom";
import { router } from "./routes";
import { ToastProvider } from "../components/ui/toast";
import { ThemeProvider } from "../components/theme/ThemeProvider";

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ThemeProvider>
  );
}
