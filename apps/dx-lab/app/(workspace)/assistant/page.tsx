// SPDX-License-Identifier: AGPL-3.0-only
import { AssistantPanel } from "../../../components/i/assistant-panel";
import { currentActor } from "../../../lib/auth/current-actor";

export default async function AssistantPage() {
  const actor = await currentActor();
  return (
    <section className="stack">
      <p className="eyebrow">I · Intelligence</p>
      <h1>Trợ lý AI</h1>
      <p className="muted">
        {actor.displayName} · lot Q&A có nguồn và draft human-in-the-loop. Không có tool confirm.
      </p>
      <AssistantPanel />
    </section>
  );
}
