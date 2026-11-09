import { v, type Infer } from "convex/values";

export const categoryValidator = v.union(
  v.literal("Power Tools"),
  v.literal("Hand Tools"),
  v.literal("Garden"),
  v.literal("Kitchen"),
  v.literal("Camping"),
  v.literal("Painting"),
  v.literal("Automotive"),
  v.literal("Other"),
);
export type Category = Infer<typeof categoryValidator>;
export const CATEGORIES: Category[] = categoryValidator.members.map(
  (m) => m.value,
);

export const conditionValidator = v.union(
  v.literal("Like new"),
  v.literal("Good"),
  v.literal("Fair"),
  v.literal("Well used"),
);
export type Condition = Infer<typeof conditionValidator>;
export const CONDITIONS: Condition[] = conditionValidator.members.map(
  (m) => m.value,
);

// requested -> accepted | rejected | cancelled
// accepted  -> returned | overdue
// overdue   -> returned
export const requestStatusValidator = v.union(
  v.literal("requested"),
  v.literal("accepted"),
  v.literal("rejected"),
  v.literal("cancelled"),
  v.literal("overdue"),
  v.literal("returned"),
);
export type RequestStatus = Infer<typeof requestStatusValidator>;

// A loan is "active" (the tool is physically out) in these states.
export const ACTIVE_LOAN_STATUSES: RequestStatus[] = ["accepted", "overdue"];

// Things n8n reports back after it has actually delivered something.
export const automationKindValidator = v.union(
  v.literal("notification_sent"),
  v.literal("reminder_sent"),
);
export type AutomationKind = Infer<typeof automationKindValidator>;
