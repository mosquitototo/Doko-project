import { api } from "./client";

export type Me = {
  id: number;
  username: string;
  email: string;
  is_staff: boolean;
  roles?: string[];
  permissions: string[];
  rbac_debug?: {
    direct_roles: string[];
  };
  timezone?: string;
  avatar_url?: string | null;
};

export async function fetchMe(): Promise<Me> {
  const res = await api.get("/api/me/");
  return res.data;
}
