import { MerchTabs } from "./merch-tabs";

export default function MerchLayout({ children }: LayoutProps<"/admin/merchandising">) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold tracking-tight">Merchandising</h1>
      <MerchTabs />
      {children}
    </div>
  );
}
