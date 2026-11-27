// SPDX-License-Identifier: AGPL-3.0-only
import { forbidden } from "next/navigation";
import { currentActor } from "../../../lib/auth/current-actor";

export default async function MembersPage() {
  const actor = await currentActor();
  if (!actor.roles.includes("administrator")) forbidden();
  return <section><p className="eyebrow">H · Human</p><h1>Thành viên tổ chức</h1>
    <p>Quản lý thành viên qua API M01 được triển khai trong T03.</p></section>;
}
