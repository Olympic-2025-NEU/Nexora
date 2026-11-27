// SPDX-License-Identifier: AGPL-3.0-only
import { forbidden } from "next/navigation";
import { currentActor } from "../../../lib/auth/current-actor";

export default async function OperationsPage() {
  const actor = await currentActor();
  if (!actor.roles.some((role) => ["administrator", "staff", "approver"].includes(role))) forbidden();
  return <section><p className="eyebrow">P · Process</p><h1>Giao dịch</h1>
    <p>Chứng từ, giao nhận và phê duyệt sẽ được nối với API M03 trong T04.</p></section>;
}
