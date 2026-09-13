import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

export type ActivityKind = "question" | "tool" | "answer" | "note";

export interface Activity {
  at: string;
  kind: ActivityKind;
  text: string;
  detail?: string;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../.turnpike");
const LOG = resolve(ROOT, "activity.jsonl");

/** What the agent is doing, so the dashboard can show her rather than only her spending. */
export function appendActivity(entry: Omit<Activity, "at">): void {
  if (!existsSync(ROOT)) mkdirSync(ROOT, { recursive: true });
  appendFileSync(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

export function readActivity(): Activity[] {
  if (!existsSync(LOG)) return [];
  return readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((l) => {
      try { return [JSON.parse(l) as Activity]; } catch { return []; }
    });
}

export const ACTIVITY_LOG = LOG;
