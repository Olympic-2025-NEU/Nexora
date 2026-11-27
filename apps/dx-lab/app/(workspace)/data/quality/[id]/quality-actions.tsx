"use client";
// SPDX-License-Identifier: AGPL-3.0-only
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  acknowledgeQualityIssueAction,
  resolveQualityIssueAction,
} from "../../../../../lib/d/quality-actions";

export function QualityActions(props: {
  id: string;
  version: number;
  state: string;
}) {
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canAck = props.state === "open";
  const canResolve = props.state === "open" || props.state === "acknowledged";

  async function run(kind: "ack" | "resolve") {
    setBusy(true);
    setError(null);
    const result = kind === "ack"
      ? await acknowledgeQualityIssueAction(props.id, props.version, reason)
      : await resolveQualityIssueAction(props.id, props.version, reason);
    if (!result.ok) {
      setError(result.message);
      setBusy(false);
      return;
    }
    router.refresh();
    setBusy(false);
  }

  if (props.state === "resolved") return null;

  return (
    <section className="panel">
      <h2>Admin actions</h2>
      <label>
        Reason
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
      <p>
        {canAck ? (
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void run("ack")}>
            Acknowledge
          </button>
        ) : null}
        {" "}
        {canResolve ? (
          <button type="button" disabled={busy || !reason.trim()} onClick={() => void run("resolve")}>
            Resolve
          </button>
        ) : null}
      </p>
    </section>
  );
}
