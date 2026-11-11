import Link from "next/link";
import { cn } from "@/lib/utils";

export function CategoryPills({
  categories,
  activeSlug,
}: {
  categories: { slug: string; name: string }[];
  activeSlug?: string;
}) {
  return (
    <nav aria-label="Categories" className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:px-0">
      <ul className="flex gap-2 pb-1">
        {categories.map((c) => (
          <li key={c.slug}>
            <Link
              href={`/c/${c.slug}`}
              aria-current={c.slug === activeSlug ? "page" : undefined}
              className={cn(
                "block whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm transition-colors hover:border-foreground/40",
                c.slug === activeSlug && "border-foreground bg-foreground text-background hover:border-foreground",
              )}
            >
              {c.name}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
