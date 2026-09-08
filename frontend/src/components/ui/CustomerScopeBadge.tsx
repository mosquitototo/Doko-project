import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { CustomerScopeOption as Customer } from "../../api/settingsCustomers";
import { customerSubgroupNames, selectCustomerScope, toggleCustomerSubgroup, type CustomerScope } from "../../utils/customerScopeSelection";

type Props = {
  customer: string | null;
  subgroups: string[];
  customers: Customer[];
  disabled?: boolean;
  display: ReactNode;
  emptyLabel?: string;
  onChange: (scope: CustomerScope) => void | Promise<void>;
};

export default function CustomerScopeBadge(props: Props) {
  const [open, setOpen] = useState(false);
  const [expandedCustomer, setExpandedCustomer] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const subgroupRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);
  const pendingFocusRef = useRef<HTMLElement | null>(null);
  const focusSubgroupRef = useRef(false);
  const menuId = useId();
  const scope = { customer: props.customer, subgroups: props.subgroups };
  const customers = props.customers.filter((customer) => customer.is_active).sort((a, b) => a.name.localeCompare(b.name));
  const expanded = customers.find((customer) => customer.id === expandedCustomer);
  const selectedNames = customerSubgroupNames(props.customers, scope);
  const locked = props.disabled || saving;

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (focusSubgroupRef.current) {
      subgroupRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      focusSubgroupRef.current = false;
    }
  }, [expandedCustomer]);

  useEffect(() => {
    if (!open || locked) return;
    const control = pendingFocusRef.current;
    if (control?.isConnected && document.activeElement === document.body) control.focus();
    pendingFocusRef.current = null;
  }, [open, locked]);

  async function changeScope(next: CustomerScope, close: boolean) {
    if (locked || savingRef.current) return;
    if (close) setOpen(false);
    if (next.customer === props.customer && next.subgroups.length === props.subgroups.length && next.subgroups.every((id) => props.subgroups.includes(id))) return;
    pendingFocusRef.current = !close && document.activeElement instanceof HTMLElement && rootRef.current?.contains(document.activeElement)
      ? document.activeElement
      : null;
    savingRef.current = true;
    setSaving(true);
    try {
      await props.onChange(next);
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function showSubgroups(customer: string, focus: boolean) {
    if (locked) return;
    if (focus && expandedCustomer === customer) {
      subgroupRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    } else {
      focusSubgroupRef.current = focus;
      setExpandedCustomer(customer);
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative inline-flex max-w-full items-center gap-2"
      onBlur={(event) => {
        if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        disabled={locked}
        aria-label="Change customer"
        title="Change customer"
        aria-expanded={open}
        aria-controls={menuId}
        aria-haspopup="dialog"
        onClick={() => {
          setExpandedCustomer(null);
          setOpen((previous) => !previous);
        }}
        className={[
          "inline-flex border-none bg-transparent items-center rounded-xl transition",
          locked ? "cursor-not-allowed opacity-60" : "cursor-pointer hover:scale-[1.05] focus:outline-none focus:ring-ring/20",
        ].join(" ")}
      >
        {props.display}
      </button>
      {selectedNames.length > 0 ? (
        <span
          tabIndex={0}
          title={selectedNames.join(", ")}
          aria-label={`Subgroups: ${selectedNames.join(", ")}`}
          className="inline-flex min-w-0 max-w-[240px] items-center rounded-full border border-border bg-card px-2.5 py-1 text-xs text-muted-foreground"
        >
          <span className="truncate">{selectedNames.length === 1 ? selectedNames[0] : `${selectedNames.length} subgroups`}</span>
        </span>
      ) : null}
      {open ? (
        <div
          id={menuId}
          role="dialog"
          aria-label="Select customer and subgroups"
          aria-busy={saving}
          className="absolute left-0 top-full z-50 mt-2 flex max-w-[calc(100vw-4rem)] flex-col rounded-2xl border border-border bg-card shadow-panel sm:flex-row"
        >
          <div className="max-h-72 w-56 max-w-full shrink-0 overflow-auto p-1.5">
            <button
              type="button"
              disabled={locked}
              aria-pressed={!props.customer}
              onClick={() => void changeScope(selectCustomerScope(null), true)}
              onPointerEnter={() => { if (!locked) setExpandedCustomer(null); }}
              className="flex w-full cursor-pointer items-center justify-between rounded-xl border-none bg-transparent px-3 py-2 text-left text-sm text-foreground hover:bg-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <span>{props.emptyLabel ?? "No customer"}</span>
              {!props.customer ? <span className="text-xs text-muted-foreground">Selected</span> : null}
            </button>
            {customers.map((customer) => (
              <div
                key={customer.id}
                className="flex items-center rounded-xl hover:bg-accent/60"
                onPointerEnter={() => { if (!locked) setExpandedCustomer(customer.subgroups?.length ? customer.id : null); }}
              >
                <button
                  type="button"
                  disabled={locked}
                  aria-pressed={props.customer === customer.id}
                  onClick={() => void changeScope(selectCustomerScope(customer.id), true)}
                  onKeyDown={(event) => {
                    if (event.key === "ArrowRight" && customer.subgroups?.length) {
                      event.preventDefault();
                      showSubgroups(customer.id, true);
                    }
                  }}
                  className="flex min-w-0 flex-1 cursor-pointer items-center justify-between gap-2 rounded-xl border-none bg-transparent px-3 py-2 text-left text-sm text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="break-words">{customer.name}</span>
                  {props.customer === customer.id ? <span className="text-xs text-muted-foreground">Selected</span> : null}
                </button>
                {customer.subgroups?.length ? (
                  <button
                    type="button"
                    disabled={locked}
                    aria-label={`Subgroups for ${customer.name}`}
                    aria-expanded={expandedCustomer === customer.id}
                    aria-controls={`${menuId}-subgroups`}
                    onClick={() => showSubgroups(customer.id, true)}
                    className="shrink-0 cursor-pointer rounded-xl border-none bg-transparent px-3 py-2 text-muted-foreground hover:text-foreground disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <span aria-hidden="true">›</span>
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          {expanded ? (
            <div
              id={`${menuId}-subgroups`}
              ref={subgroupRef}
              role="group"
              aria-label={`Subgroups for ${expanded.name}`}
              className="max-h-72 w-56 max-w-full overflow-auto border-t border-border p-1.5 sm:border-l sm:border-t-0"
              onKeyDown={(event) => {
                if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  rootRef.current?.querySelector<HTMLButtonElement>(`[aria-controls="${menuId}-subgroups"][aria-expanded="true"]`)?.focus();
                }
              }}
            >
              <div className="px-3 py-2 text-xs font-medium text-muted-foreground">{expanded.name} subgroups</div>
              {expanded.subgroups?.map((subgroup) => (
                <label key={subgroup.id} className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-foreground hover:bg-accent/60 ${locked ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={props.customer === expanded.id && props.subgroups.includes(subgroup.id)}
                    onChange={() => void changeScope(toggleCustomerSubgroup(scope, expanded.id, subgroup.id), false)}
                    className="shrink-0 accent-primary"
                  />
                  <span className="min-w-0 break-words">{subgroup.name}</span>
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
