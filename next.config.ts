// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const rootDir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8")) as {
  version?: string;
};
const appVersion = typeof pkg.version === "string" && pkg.version ? pkg.version : "0.1.0";
const appCommit = (
  process.env.GITHUB_SHA ||
  process.env.NEXORA_GIT_COMMIT ||
  ""
).trim().slice(0, 12);

const nextConfig: NextConfig = {
  env: {
    NEXT_PUBLIC_APP_VERSION: appVersion,
    NEXT_PUBLIC_APP_COMMIT: appCommit,
  },
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
  /** ADR 0016 — legacy /admin and /catalog product mounts → /products. */
  async redirects() {
    return [
      {
        source: "/admin/partners",
        destination: "/partners",
        permanent: false,
      },
      {
        source: "/admin/federation",
        destination: "/partners",
        permanent: false,
      },
      {
        source: "/partners/new",
        destination: "/partners",
        permanent: false,
      },
      {
        source: "/partners/:id",
        destination: "/partners",
        permanent: false,
      },
      {
        source: "/admin/products",
        destination: "/products",
        permanent: false,
      },
      {
        source: "/catalog",
        destination: "/products",
        permanent: false,
      },
      {
        source: "/catalog/products",
        destination: "/products",
        permanent: false,
      },
      {
        source: "/catalog/products/:path*",
        destination: "/products/:path*",
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
