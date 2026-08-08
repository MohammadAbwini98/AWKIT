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

  // A synthetic wait belongs to the action immediately after it. Cascades can remove more than the
  // selected action, so remove each cascaded consumer's own wait without touching a wait that now
  // legitimately precedes the first remaining action.
  for (let index = 1; index < actions.length; index += 1) {
    if (removed.has(actions[index].id) && actions[index - 1]?.type === "wait") {
      removed.add(actions[index - 1].id);
    }
  }

  const remaining = actions.filter((action) => !removed.has(action.id));
  // A trailing wait has no consumer and is never standalone intent.
  while (remaining[remaining.length - 1]?.type === "wait") removed.add(remaining.pop()!.id);

  return { actions: remaining, removedIds: [...removed] };
}
