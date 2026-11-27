// SPDX-License-Identifier: AGPL-3.0-only
const shared = [
  { href: "/work", label: "H · Công việc" },
  { href: "/data", label: "D · Dữ liệu" },
  { href: "/assistant", label: "I · Trợ lý" },
  { href: "/profile", label: "Hồ sơ" },
] as const;

export function navigationForRoles(roles: readonly string[]) {
  const canOperate = roles.some((role) => ["administrator", "staff", "approver"].includes(role));
  const canAdmin = roles.includes("administrator");
  const canReadPartners = roles.some((role) =>
    ["administrator", "staff", "approver", "viewer"].includes(role));
  return [
    shared[0],
    ...(canOperate ? [{ href: "/operations", label: "P · Giao dịch" }] : []),
    ...shared.slice(1),
    ...(canReadPartners ? [{ href: "/partners", label: "Đối tác" }] : []),
    ...(canAdmin ? [{ href: "/members", label: "Thành viên" }] : []),
  ];
}
