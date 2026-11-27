// SPDX-License-Identifier: AGPL-3.0-only
import { currentActor } from "../../../lib/auth/current-actor";

export default async function WorkPage() {
  const actor = await currentActor();
  return <section><p className="eyebrow">H · Human</p><h1>Công việc của tôi</h1>
    <p>Xin chào {actor.displayName || "thành viên"}. Vùng công việc đang được nối với task inbox và hồ sơ ở T03.</p>
  </section>;
}
