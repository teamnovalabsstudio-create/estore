"use client";

import { Copy, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { createStaffAction, updateStaffAction } from "@/actions/admin-catalog";
import { EditorSheet } from "@/components/admin/editor-sheet";
import { Field, inputCls, selectCls } from "@/components/admin/form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Staff = { id: string; name: string; email: string; role: "OWNER" | "STAFF" | "PACKER"; isActive: boolean; lastLoginAt: string | null };
const ROLE_HINT = { OWNER: "Everything, including settings and staff", STAFF: "Orders, fulfilment, products, merchandising", PACKER: "Fulfilment only" };

export function StaffManager({ rows, meId }: { rows: Staff[]; meId: string }) {
  const [draft, setDraft] = useState<{ name: string; email: string; role: Staff["role"] } | null>(null);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const update = (s: Staff, change: { role?: string; isActive?: boolean }) =>
    start(async () => {
      const r = await updateStaffAction(s.id, change);
      if (r.ok) toast.success(`${s.name} updated`);
      else toast.error(r.error);
    });

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button
          onClick={() => {
            setErrors({});
            setError(null);
            setDraft({ name: "", email: "", role: "STAFF" });
          }}
        >
          <Plus /> Add staff
        </Button>
      </div>

      {created && (
        <div className="space-y-2 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950 dark:bg-emerald-950/30 dark:text-emerald-100" role="status">
          <p className="font-medium">Login created for {created.email}</p>
          <p>Share this one-time password privately. It won’t be shown again.</p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-background px-2 py-1 font-mono text-foreground" data-testid="temp-password">
              {created.password}
            </code>
            <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(created.password).then(() => toast.success("Copied"))}>
              <Copy /> Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setCreated(null)}>
              Done
            </Button>
          </div>
        </div>
      )}

      <ul className="divide-y rounded-xl border" data-testid="staff-list">
        {rows.map((s) => (
          <li key={s.id} className="flex flex-wrap items-center gap-3 p-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {s.name} {s.id === meId && <span className="text-xs text-muted-foreground">(you)</span>}
              </p>
              <p className="text-xs text-muted-foreground">
                {s.email} · {s.lastLoginAt ? `last in ${new Date(s.lastLoginAt).toLocaleDateString("en-PK")}` : "never signed in"}
              </p>
            </div>
            <select aria-label={`Role for ${s.name}`} value={s.role} disabled={pending || s.id === meId} onChange={(e) => update(s, { role: e.target.value })} className="h-8 rounded-lg border bg-background px-2 text-sm">
              <option value="OWNER">Owner</option>
              <option value="STAFF">Staff</option>
              <option value="PACKER">Packer</option>
            </select>
            <Button size="sm" variant="ghost" disabled={pending || s.id === meId} onClick={() => update(s, { isActive: !s.isActive })} className={s.isActive ? "text-destructive" : undefined}>
              {s.isActive ? "Deactivate" : "Reactivate"}
            </Button>
          </li>
        ))}
      </ul>

      {draft && (
        <EditorSheet
          open
          onOpenChange={(o) => !o && setDraft(null)}
          title="Add staff"
          error={error}
          saving={pending}
          onSave={() =>
            start(async () => {
              const r = await createStaffAction(draft);
              if (r.ok && r.tempPassword) {
                setCreated({ email: draft.email, password: r.tempPassword });
                setDraft(null);
              } else if (!r.ok) {
                setErrors(r.fieldErrors ?? {});
                setError(r.error);
              }
            })
          }
        >
          <Field label="Name" htmlFor="sname" error={errors.name}>
            <Input id="sname" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Email" htmlFor="semail" error={errors.email}>
            <Input id="semail" type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} className={inputCls} />
          </Field>
          <Field label="Role" htmlFor="srole" hint={ROLE_HINT[draft.role]}>
            <select id="srole" value={draft.role} onChange={(e) => setDraft({ ...draft, role: e.target.value as Staff["role"] })} className={selectCls}>
              <option value="STAFF">Staff</option>
              <option value="PACKER">Packer</option>
              <option value="OWNER">Owner</option>
            </select>
          </Field>
        </EditorSheet>
      )}
    </div>
  );
}
