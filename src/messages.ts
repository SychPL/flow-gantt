import type { FlowMessages } from "./types.js";

/** English defaults for every accessibility string (I18N-1). */
export const defaultMessages: FlowMessages = {
  chartLabel: "Flow chart",
  startsAfter: (labels) => `Starts after: ${labels.join(", ")}.`,
  followedBy: (labels) => `Followed by: ${labels.join(", ")}.`,
  none: "none",
  status: {
    error: "Has errors",
    warning: "Warning",
    success: "Succeeded",
    running: "Running",
    pending: "Pending",
    skipped: "Skipped",
  },
  selectionCount: (count) => (count === 1 ? "1 item selected" : `${count} items selected`),
  groupExpanded: (label) => `${label} expanded`,
  groupCollapsed: (label) => `${label} collapsed`,
  linkingStarted: (label) =>
    `Linking from ${label}. Choose a target with the arrow keys, press Enter to connect or Escape to cancel.`,
  linkCandidate: (label, allowed) => `Connect to ${label}, ${allowed ? "allowed" : "not allowed"}`,
  dependencyCreated: (from, to) => `Dependency created from ${from} to ${to}`,
  dependencyRejected: (from, to) => `Dependency from ${from} to ${to} not allowed`,
  rowMoved: (label, position) => `${label} moved to position ${position}`,
  variant: (variant) => (variant === "delayed" ? "Delayed." : variant === "dependent" ? "Depends on other items." : ""),
  longestPath: "On the longest path.",
};
