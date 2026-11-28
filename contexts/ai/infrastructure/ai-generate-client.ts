// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatFact, GeneratePort } from "../application/chat-lot-lookup";

const INTERNAL_HOSTS = new Set(["ai", "127.0.0.1", "localhost"]);

export function createAiGenerateClient(fetcher: typeof fetch = fetch): GeneratePort {
  return {
    async generate(question: string, facts: ChatFact[]): Promise<{ answer: string } | null> {
      if (process.env.AI_PROVIDER !== "ollama") return null;
      const base = process.env.AI_BASE_URL;
      const token = process.env.AI_INTERNAL_TOKEN;
      if (!base || !token || token.length < 32 || token.startsWith("CHANGE_ME_")) return null;
      let url: URL;
      try {
        url = new URL("/v1/generate", base);
      } catch {
        return null;
      }
      if (url.protocol !== "http:" || !INTERNAL_HOSTS.has(url.hostname) || url.username || url.password) return null;
      const safeQuestion = question.trim().slice(0, 300);
      const safeFacts = facts.slice(0, 10).map((fact) => ({
        kind: fact.kind,
        value: fact.value.slice(0, 100),
        sourceId: fact.sourceId.slice(0, 100),
        asOf: fact.asOf.slice(0, 100),
        verification: fact.verification,
      }));
      try {
        const response = await fetcher(url.toString(), {
          method: "POST",
          redirect: "error",
          cache: "no-store",
          signal: AbortSignal.timeout(30_000),
          headers: { "content-type": "application/json", "x-ai-internal-token": token },
          body: JSON.stringify({ question: safeQuestion, facts: safeFacts }),
        });
        if (!response.ok) return null;
        const payload: unknown = await response.json();
        const answer = payload && typeof payload === "object" && "answer" in payload &&
          typeof (payload as { answer: unknown }).answer === "string"
          ? (payload as { answer: string }).answer : "";
        return answer.trim() ? { answer: answer.slice(0, 240) } : null;
      } catch {
        return null;
      }
    },
  };
}
