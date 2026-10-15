/**
 * FA-19172: whether an app's chat has a turn in flight, as the chat last read it (the legacy studio's chatTurn(), which the Agent button
 * reads to spin while the agent replies). The chat writes it; the Agent button listens. Like the legacy studio, nothing polls while
 * the chat is closed, so this is the chat's last word.
 */
import { useSyncExternalStore } from "react";

const turns = new Map<string, boolean>();
const subs = new Set<() => void>();

export function setTalking(app: string, on: boolean) {
  if (Boolean(turns.get(app)) === on) return;
  turns.set(app, on);
  for (const f of subs) f();
}

export function useTalking(app: string): boolean {
  return useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => Boolean(turns.get(app)),
    () => false,
  );
}
