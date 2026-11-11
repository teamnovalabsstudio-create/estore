"use client";

import { Loader2 } from "lucide-react";
import { useActionState } from "react";
import { trackOrderAction, type TrackState } from "@/actions/checkout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TrackForm() {
  const [state, action, pending] = useActionState<TrackState, FormData>(trackOrderAction, {});
  return (
    <form action={action} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="orderNumber">Order number</Label>
        <Input id="orderNumber" name="orderNumber" placeholder="MS-261111-0042" defaultValue={state.orderNumber} required className="h-11 uppercase" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="phone">Mobile number</Label>
        <Input id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel-national" placeholder="0300 1234567" defaultValue={state.phone} required className="h-11" />
      </div>
      {state.error && (
        <p className="text-sm text-destructive" role="alert">
          {state.error}
        </p>
      )}
      <Button type="submit" size="lg" className="h-11 w-full" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />}
        Find my order
      </Button>
    </form>
  );
}
