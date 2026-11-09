import { v, type Infer } from "convex/values";

export const categoryValidator = v.union(
  v.literal("Power Tools"),
  v.literal("Gardening"),
  v.literal("Hand Tools"),
  v.literal("Painting"),
  v.literal("Ladders & Access"),
  v.literal("Automotive"),
  v.literal("Cleaning"),
  v.literal("Other"),
);
export type Category = Infer<typeof categoryValidator>;
export const CATEGORIES: Category[] = categoryValidator.members.map(
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
