// SPDX-License-Identifier: AGPL-3.0-only
import { redirect } from "next/navigation";

/** Legacy ops route — monitoring lives on the unified `/partners` connection screen. */
export default function FederationOperationsRedirectPage() {
  redirect("/partners");
}
