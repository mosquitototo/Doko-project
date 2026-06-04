import { useEffect, useState } from "react";
import { api } from "../api/client";

export function useMe() {
  const [me, setMe] = useState<{ id: number; username: string; email: string } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let mounted = true;
    setLoading(true);

    api
      .get("/api/me/")
      .then((res) => mounted && setMe(res.data))
      .catch(() => mounted && setMe(null))
      .finally(() => mounted && setLoading(false));

    return () => {
      mounted = false;
    };
  }, []);

  return { me, loading };
}
