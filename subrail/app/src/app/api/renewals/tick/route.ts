import { NextResponse } from 'next/server';

/**
 * Cron-invoked renewal tick (docs/03-spec.md §3): load due RenewalJobs (row-locked),
 * run scheduler.decide per job, execute effects via the LastLeg registry, persist.
 *
 * TODO(M1): wire Drizzle/Postgres job store; until then this is a no-op skeleton so the
 * cron plumbing can be deployed and observed.
 */
export async function POST() {
  return NextResponse.json({ executed: 0, failed: 0, note: 'job store not wired yet (M1)' });
}
