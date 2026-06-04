import { createContext, useContext } from "react";
import type { Me } from "../api/me";

export type MeContextValue = {
  me: Me | null;
  reloadMe: () => Promise<void>;
};

export const MeContext = createContext<MeContextValue>({
  me: null,
  reloadMe: async () => {},
});

export function useMe() {
  return useContext(MeContext).me;
}

export function useReloadMe() {
  return useContext(MeContext).reloadMe;
}