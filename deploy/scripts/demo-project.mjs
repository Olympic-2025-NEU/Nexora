// SPDX-License-Identifier: AGPL-3.0-only
// Deliberately narrow project allowlist for disposable three-instance G09 reruns.
export function demoProject(instance) {
  if (!/^[abc]$/.test(instance)) throw new Error("Expected a|b|c demo instance");
  const prefix = process.env.NEXORA_DEMO_PROJECT_PREFIX ?? "nexora";
  if (prefix !== "nexora" && prefix !== "nexora-g09")
    throw new Error("Unsupported demo project prefix");
  return `${prefix}-${instance}`;
}
