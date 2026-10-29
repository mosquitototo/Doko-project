import { useEffect, useRef } from "react";
import { listCaseExchanges } from "../../../api/exchanges";
import { useToast } from "../../ui/toast";
import CaseExchangesTab from "./CaseExchangesTab";
import { useExchanges } from "./useExchanges";

export default function AlertExchangesPanel({ alertId, busy, canUpdate }: { alertId: string; busy: boolean; canUpdate: boolean }) {
  const { push } = useToast();
  const sequence = useRef(0);
  const controller = useExchanges({ ticketId: alertId, scope: "alert", canUpdateCase: canUpdate, refreshExchanges, push });

  async function refreshExchanges() {
    const current = ++sequence.current;
    controller.setExchangesBusy(true);
    try {
      const rows = await listCaseExchanges(alertId, "alert");
      if (current === sequence.current) controller.setExchanges(rows);
    } catch (error: any) {
      if (current === sequence.current) push({ kind: "error", title: "Error", message: String(error?.response?.data?.detail ?? "Unable to load exchanges.") });
    } finally {
      if (current === sequence.current) controller.setExchangesBusy(false);
    }
  }

  useEffect(() => {
    void refreshExchanges();
    const interval = window.setInterval(() => void refreshExchanges(), 30000);
    return () => { sequence.current++; window.clearInterval(interval); };
  }, [alertId]);

  return <CaseExchangesTab {...controller} alertId={alertId} busy={busy} canUpdateCase={canUpdate} refreshExchanges={refreshExchanges} push={push} />;
}
