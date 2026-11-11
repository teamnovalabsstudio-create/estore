import Image, { type ImageProps } from "next/image";

/**
 * next/image wrapper. Seed placeholders are local SVGs, which the optimizer
 * won't transcode, so those bypass optimization; real photos (Cloudinary/S3)
 * go through WebP/AVIF optimization as normal.
 */
export function ProductImage({ src, alt, ...rest }: ImageProps) {
  const isSvg = typeof src === "string" && src.endsWith(".svg");
  return <Image src={src} alt={alt} unoptimized={isSvg || rest.unoptimized} {...rest} />;
}
