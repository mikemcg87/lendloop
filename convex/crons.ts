import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// A no-op unless the deployment is configured as a public demo (see seed.ts).
crons.daily(
  "reset demo data",
  { hourUTC: 4, minuteUTC: 0 },
  internal.seed.resetDemo,
);

export default crons;
