// SPDX-License-Identifier: AGPL-3.0-only
import { currentActor } from "../../../lib/auth/current-actor";

export default async function ProfilePage() {
  const actor = await currentActor();
  return <section><p className="eyebrow">H · Human</p><h1>Hồ sơ</h1>
    <dl className="profile"><dt>Tên hiển thị</dt><dd>{actor.displayName || "Chưa có"}</dd>
      <dt>Vai trò</dt><dd>{actor.roles.join(", ")}</dd>
      <dt>Tổ chức</dt><dd>{actor.organizationId}</dd></dl>
  </section>;
}
