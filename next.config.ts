import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  images: {
    // Only our own paths, and never with a query string (blocks optimizer abuse).
    localPatterns: [
      { pathname: "/seed/**", search: "" },
      { pathname: "/media/**", search: "" },
    ],
  },
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
