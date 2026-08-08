import type { RecordedAction } from "./RecorderTypes";

export interface RecordedActionRemoval {
  actions: RecordedAction[];
  removedIds: string[];
}

/**
 * Remove one recorded action and only the bookkeeping that cannot remain meaningful without it.
 * Popup opener removal is a bounded cascade over that popup alias; ordinary actions never cascade.
 */
export function removeRecordedAction(actions: RecordedAction[], actionId: string): RecordedActionRemoval {
  const targetIndex = actions.findIndex((action) => action.id === actionId);
  if (targetIndex < 0) return { actions: [...actions], removedIds: [] };

  const removed = new Set<string>([actionId]);
  const target = actions[targetIndex];

  // A captured think-time wait immediately before an action exists only to delay that action.
  const prior = actions[targetIndex - 1];
  if (prior?.type === "wait") removed.add(prior.id);

  const popupAlias = target.popupExpectation?.popupAlias;
  if (target.opensPopup && popupAlias) {
    for (const action of actions) {
      if (
        action.pageAlias === popupAlias ||
        action.popupExpectation?.popupAlias === popupAlias ||
        action.config?.popupAlias === popupAlias
      ) {
        removed.add(action.id);
      }
    }
  }

  const remaining = actions.filter((action) => !removed.has(action.id));
  // Boundary waits cannot delay an action after a deletion cascade and are never standalone intent.
  while (remaining[0]?.type === "wait") removed.add(remaining.shift()!.id);
  while (remaining[remaining.length - 1]?.type === "wait") removed.add(remaining.pop()!.id);

  return { actions: remaining, removedIds: [...removed] };
}
