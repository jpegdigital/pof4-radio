import type { PreparedHeadline, PreparedWeather } from "../../../lib/prepared.ts";
import type { HeadlineChoice } from "./headline-choice.ts";
import type { PickReceipt } from "./pick.ts";
import type { PlanningReceipt } from "./planning.ts";
import type { WriteInput, WriterReceipt } from "./write.ts";

/** Server-only, retained in the slot. Decisions survive Claude/TTS failures and explicit revoices. */
export interface SlotGeneration {
  version: "prepared-1";
  id: string;
  preparedAt: string;
  clockMs: number;
  selection: PickReceipt & { planning: PlanningReceipt };
  news: { entryId: string | null; date: string | null; selected: PreparedHeadline[]; choice: HeadlineChoice };
  weather: { entryId: string; date: string; data: PreparedWeather } | null;
  input: WriteInput;
  writer?: WriterReceipt;
  attempts?: { at: string; input: WriteInput; writer: WriterReceipt; error?: string }[];
  takes?: {
    clipKey: string;
    at: string;
    words: string;
    legalId: string | null;
    leadLine: string | null;
    voiceId: string;
    request: unknown;
    bytes: number;
  }[];
}
