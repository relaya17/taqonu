"use client";

import { PlanView } from "@/components/views/PlanView";

/**
 * Public pricing stays a standalone page (signed-out visitors reach it from
 * the landing page). Signed in, the same view also lives under Account.
 */
export default function PlanPage() {
  return <PlanView />;
}
