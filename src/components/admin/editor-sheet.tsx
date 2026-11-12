"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormError } from "./form";

/** Slide-over editor shell shared by merchandising and settings screens. */
export function EditorSheet({
  open,
  onOpenChange,
  title,
  description,
  error,
  saving,
  onSave,
  onDelete,
  deleteLabel = "Delete",
  children,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  description?: string;
  error?: string | null;
  saving: boolean;
  onSave: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  children: React.ReactNode;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="gap-0 data-[side=right]:w-full data-[side=right]:sm:max-w-lg" data-testid="editor-sheet">
        <SheetHeader className="border-b">
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription className={description ? undefined : "sr-only"}>{description ?? title}</SheetDescription>
        </SheetHeader>
        <form
          id="editor-sheet-form"
          className="flex-1 space-y-4 overflow-y-auto p-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSave();
          }}
        >
          <FormError message={error} />
          {children}
        </form>
        <SheetFooter className="flex-row justify-between border-t">
          {onDelete ? (
            <Button type="button" variant="ghost" className="text-destructive" disabled={saving} onClick={onDelete}>
              {deleteLabel}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" form="editor-sheet-form" disabled={saving}>
            {saving && <Loader2 className="animate-spin" />}
            Save
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
