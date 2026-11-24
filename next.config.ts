// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    agentFeedback: true,
  },
  cacheComponents: true,
  partialPrefetching: true,
  async headers() {
    return [{ source: "/passport/:token", headers: [
      { key: "Cache-Control", value: "private, no-store, max-age=0" },
      { key: "Referrer-Policy", value: "no-referrer" },
      { key: "X-Robots-Tag", value: "noindex, nofollow" },
    ] }];
  },
  /** ADR 0016 — legacy /admin product mounts → bounded-context surfaces. */
  async redirects() {
    return [
      {
        source: "/admin/partners",
        destination: "/partners",
        permanent: false,
      },
      {
        source: "/admin/products",
        destination: "/catalog/products",
        permanent: false,
      },
      {
        source: "/admin/batches",
        destination: "/catalog/batches",
        permanent: false,
      },
      {
        source: "/admin/warehouses",
        destination: "/inventory/warehouses",
        permanent: false,
      },
      {
        source: "/admin/inventory",
        destination: "/inventory/balances",
        permanent: false,
      },
    ];
  },
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
