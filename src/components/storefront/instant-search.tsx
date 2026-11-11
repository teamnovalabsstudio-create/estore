"use client";

import { Loader2, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { formatPKR } from "@/domain/money";
import { cn } from "@/lib/utils";
import { ProductImage } from "./product-image";

type Hit = { slug: string; title: string; imageUrl: string | null; minPricePaisa: number };

/**
 * Header search: debounced suggestions from /api/search; Enter goes to the
 * full results page. Keyboard: ↑/↓ to move, Enter to open, Esc to close.
 */
export function InstantSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState("");
  // Results are remembered with the term they belong to, so "loading" and
  // stale-result hiding are derived during render rather than set in effects.
  const [result, setResult] = useState<{ term: string; hits: Hit[] }>({ term: "", hits: [] });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);

  const term = q.trim();
  const searching = term.length >= 2;
  const loading = searching && result.term !== term;
  const hits = searching ? result.hits : [];

  useEffect(() => {
    if (!searching) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctrl.signal });
        const data = res.ok ? ((await res.json()) as { hits: Hit[] }) : { hits: [] };
        setResult({ term, hits: data.hits });
        setActive(-1);
      } catch {
        /* aborted (newer keystroke) or offline */
      }
    }, 180);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [term, searching]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && hits[active]) go(`/p/${hits[active].slug}`);
      else if (q.trim()) go(`/search?q=${encodeURIComponent(q.trim())}`);
    }
  };

  const showPanel = open && q.trim().length >= 2;

  return (
    <div ref={boxRef} className={cn("relative", className)}>
      <form role="search" onSubmit={(e) => e.preventDefault()}>
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={q}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search organizers, mini fans, pens…"
          aria-label="Search products"
          role="combobox"
          aria-expanded={showPanel}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
          className="h-10 w-full rounded-full border bg-muted/50 pr-9 pl-9 text-sm outline-none transition-colors placeholder:text-muted-foreground focus:border-ring focus:bg-background [&::-webkit-search-cancel-button]:hidden"
        />
        {loading ? (
          <Loader2 className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        ) : (
          q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQ("")}
              className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded-full p-0.5 text-muted-foreground hover:text-foreground"
            >
              <X className="size-4" />
            </button>
          )
        )}
      </form>

      {showPanel && (
        <div className="absolute inset-x-0 top-12 z-50 overflow-hidden rounded-xl border bg-popover shadow-lg">
          {hits.length === 0 && !loading ? (
            <p className="p-4 text-sm text-muted-foreground">No matches for “{q.trim()}”.</p>
          ) : (
            <ul id={listId} role="listbox" className="max-h-96 overflow-y-auto py-1">
              {hits.map((h, i) => (
                <li key={h.slug} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
                  <Link
                    href={`/p/${h.slug}`}
                    onClick={() => setOpen(false)}
                    className={cn("flex items-center gap-3 px-3 py-2 hover:bg-muted", i === active && "bg-muted")}
                  >
                    <span className="size-10 shrink-0 overflow-hidden rounded-md bg-muted">
                      {h.imageUrl && <ProductImage src={h.imageUrl} alt="" width={40} height={40} className="size-10 object-cover" />}
                    </span>
                    <span className="flex-1 truncate text-sm">{h.title}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{formatPKR(h.minPricePaisa)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {hits.length > 0 && (
            <Link
              href={`/search?q=${encodeURIComponent(q.trim())}`}
              onClick={() => setOpen(false)}
              className="block border-t px-3 py-2.5 text-center text-sm font-medium text-primary hover:bg-muted"
            >
              See all results
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
