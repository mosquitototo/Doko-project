import { api } from "./client";
export type UserLite = { id: number; username: string };

export async function fetchUsersLite(q?: string): Promise<UserLite[]> {
  const res = await api.get("/api/users-lite/", { params: q ? { q } : undefined });
  return res.data;
}
