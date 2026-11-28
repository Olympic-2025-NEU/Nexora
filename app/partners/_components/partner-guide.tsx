// SPDX-License-Identifier: AGPL-3.0-only
"use client";

import { useT } from "@/app/i18n/LocaleProvider";

const STEPS = [
  "partners.guideStep1",
  "partners.guideStep2",
  "partners.guideStep3",
  "partners.guideStep4",
  "partners.guideStep5",
  "partners.guideStep6",
] as const;

/** In-app business-language checklist for linking two enterprises. */
export function PartnerGuide() {
  const t = useT();
  return (
    <aside
      className="rounded-lg border border-border bg-card p-4"
      data-purpose="partner-link-guide"
    >
      <h2 className="text-sm font-semibold">{t("partners.guideTitle")}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{t("partners.guideIntro")}</p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm text-foreground">
        {STEPS.map((key) => (
          <li key={key}>{t(key)}</li>
        ))}
      </ol>
    </aside>
  );
}
