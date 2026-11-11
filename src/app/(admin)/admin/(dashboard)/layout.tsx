import { Suspense } from "react";
import { logoutAction } from "@/actions/admin-auth";
import { AdminNav } from "@/components/admin/admin-nav";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/guard";

export default function AdminLayout({ children }: LayoutProps<"/admin">) {
  return (
    <div className="flex min-h-screen flex-1 flex-col md:flex-row">
      <aside className="border-b bg-muted/30 p-3 md:w-56 md:shrink-0 md:border-r md:border-b-0 md:p-4">
        <div className="mb-3 px-3 text-lg font-bold tracking-tight md:mb-6">
          <span className="text-primary">hikari</span> admin
        </div>
        <AdminNav />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end gap-3 border-b px-4 md:px-6">
          <Suspense fallback={<span className="h-4 w-24 animate-pulse rounded bg-muted" />}>
            <CurrentAdmin />
          </Suspense>
        </header>
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}

async function CurrentAdmin() {
  const user = await requireAdmin();
  return (
    <>
      <span className="text-sm text-muted-foreground">
        {user.name} · <span className="lowercase">{user.role}</span>
      </span>
      <form action={logoutAction}>
        <Button variant="outline" size="sm" type="submit">
          Sign out
        </Button>
      </form>
    </>
  );
}
