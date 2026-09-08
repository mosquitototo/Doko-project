import type { CustomerSubgroupContact, CustomerSubgroupPayload } from "../../api/settingsCustomers";
import Card from "../ui/Card";
import { DeleteButton, NewGenButton } from "../ui/IconButton";

const inputClass = "h-11 w-full rounded-2xl border border-border bg-background px-3 text-sm text-foreground outline-none transition placeholder:text-muted-foreground focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-60";
const labelClass = "block text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground";
const contactFields = [
  { key: "name", label: "Name", type: "text" },
  { key: "title", label: "Title", type: "text" },
  { key: "email", label: "Email", type: "email" },
  { key: "phone", label: "Phone", type: "tel" },
] as const;

export default function CustomerSubgroupFields({ value, onChange, disabled = false }: {
  value: CustomerSubgroupPayload[];
  onChange: (value: CustomerSubgroupPayload[]) => void;
  disabled?: boolean;
}) {
  const update = (index: number, patch: Partial<CustomerSubgroupPayload>) =>
    onChange(value.map((group, row) => row === index ? { ...group, ...patch } : group));
  const updateContact = (index: number, contactIndex: number, patch: Partial<CustomerSubgroupContact>) =>
    update(index, { contacts: value[index].contacts.map((contact, row) => row === contactIndex ? { ...contact, ...patch } : contact) });

  return (
    <Card className="p-5">
      <fieldset disabled={disabled} className="min-w-0 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <div className="text-sm font-semibold text-foreground">Subgroups</div>
            <p className="mt-1 text-xs text-muted-foreground">Organize this customer into subgroups with their own descriptions and contacts.</p>
          </div>
          <NewGenButton title="Add subgroup" label="Add subgroup" iconOnly={false} disabled={disabled} onClick={() => onChange([...value, { name: "", description: "", contacts: [] }])} />
        </div>
        {value.length === 0 ? <p className="rounded-2xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">No subgroups yet.</p> : null}
        {value.map((group, index) => (
          <div key={group.id ?? index} className="space-y-3 rounded-2xl border border-border bg-background p-4">
            <div className="flex items-end gap-3">
              <label className="block min-w-0 flex-1 space-y-2">
                <span className={labelClass}>Subgroup name <span className="text-red-500">*</span></span>
                <input className={inputClass} value={group.name} maxLength={200} placeholder="Subgroup name" required onChange={(event) => update(index, { name: event.target.value })} />
              </label>
              <DeleteButton title={`Remove subgroup ${group.name || index + 1}`} disabled={disabled} onClick={() => onChange(value.filter((_, row) => row !== index))} />
            </div>
            <details className="group">
              <summary className="cursor-pointer rounded-lg py-2 text-sm font-medium text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring">Description and contacts ({group.contacts.length})</summary>
              <div className="mt-3 space-y-4">
                {group.id ? <p className="break-all font-mono text-xs text-muted-foreground">UUID: {group.id}</p> : null}
                <label className="block space-y-2">
                  <span className={labelClass}>Description</span>
                  <textarea className={`${inputClass} h-auto resize-y py-3`} rows={3} value={group.description} onChange={(event) => update(index, { description: event.target.value })} />
                </label>
                <div className="flex items-center justify-between gap-3">
                  <span className={labelClass}>Subgroup contacts</span>
                  <NewGenButton title="Add subgroup contact" label="Add contact" iconOnly={false} disabled={disabled} onClick={() => update(index, { contacts: [...group.contacts, { name: "", email: "", phone: "", title: "" }] })} />
                </div>
                {group.contacts.length === 0 ? <p className="text-xs text-muted-foreground">No contacts yet.</p> : null}
                {group.contacts.map((contact, contactIndex) => (
                  <div key={contactIndex} className="space-y-3 rounded-2xl border border-border p-4">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-foreground">{contact.name || `Contact ${contactIndex + 1}`}</span>
                      <DeleteButton title={`Remove subgroup contact ${contact.name || contactIndex + 1}`} disabled={disabled} onClick={() => update(index, { contacts: group.contacts.filter((_, row) => row !== contactIndex) })} />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      {contactFields.map((field) => (
                        <label key={field.key} className="block space-y-2">
                          <span className={labelClass}>{field.label}{field.key === "name" ? <span className="ml-1 text-red-500">*</span> : null}</span>
                          <input className={inputClass} type={field.type} required={field.key === "name"} value={contact[field.key]} onChange={(event) => updateContact(index, contactIndex, { [field.key]: event.target.value })} />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </details>
          </div>
        ))}
        {value.length ? <p className="text-xs text-muted-foreground">Removing a subgroup clears its associations when saved; existing alerts and cases remain.</p> : null}
      </fieldset>
    </Card>
  );
}
