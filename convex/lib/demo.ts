// True only on a deployment deliberately marked as a public demo. The value
// must be exactly "true": the flag turns on a daily wipe (see seed.ts), so
// DEMO_MODE=false or DEMO_MODE=0 must not count.
export const isDemo = () => process.env.DEMO_MODE === "true";
