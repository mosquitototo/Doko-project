import { Navigate } from "react-router-dom";
import type { Me } from "../api/me";

export default function RequireAnyPerm({
  me,
  any,
  children,
}: {
  me: Me | null;
  any: string[];
  children: React.ReactNode;
}) {
  if (!me) {
    return <Navigate to="/login" replace />;
  }

  const ok = me.is_staff || any.some((p) => me.permissions?.includes(p));

  if (!ok) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}