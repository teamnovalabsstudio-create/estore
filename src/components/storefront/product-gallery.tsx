"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { ProductImage } from "./product-image";

type Img = { id: string; url: string; alt: string; width: number; height: number };

export function ProductGallery({ images, title }: { images: Img[]; title: string }) {
  const [index, setIndex] = useState(0);
  const current = images[index] ?? images[0];
  if (!current) return <div className="aspect-square rounded-2xl bg-muted" />;

  return (
    <div className="space-y-3">
      <div className="overflow-hidden rounded-2xl bg-muted">
        <ProductImage
          src={current.url}
          alt={current.alt || title}
          width={current.width}
          height={current.height}
          preload
          fetchPriority="high"
          sizes="(min-width: 768px) 50vw, 100vw"
          className="aspect-square w-full object-cover"
        />
      </div>
      {images.length > 1 && (
        <ul className="flex gap-2 overflow-x-auto">
          {images.map((img, i) => (
            <li key={img.id}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Show image ${i + 1}`}
                aria-current={i === index}
                className={cn("overflow-hidden rounded-lg border-2", i === index ? "border-foreground" : "border-transparent")}
              >
                <ProductImage src={img.url} alt="" width={72} height={72} className="size-16 object-cover" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
