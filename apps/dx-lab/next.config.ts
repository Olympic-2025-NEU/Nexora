// SPDX-License-Identifier: AGPL-3.0-only
import type { NextConfig } from "next";
import { resolve } from "node:path";

const config: NextConfig = {
  basePath: "/dxlab",
  output: "standalone",
  outputFileTracingRoot: resolve(__dirname, "../.."),
};

export default config;
