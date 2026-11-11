import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-20 text-center">
      <p className="text-5xl">🔍</p>
      <h1 className="mt-4 text-xl font-semibold">We couldn’t find that page</h1>
      <p className="mt-2 text-sm text-muted-foreground">It may have sold out or moved.</p>
      <Link href="/" className="mt-6 inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
        Back to shop
      </Link>
    </div>
  );
}
