/**
 * Where the program's files live. The maker (/program/make) writes program.json and the voiced
 * clips under /program/make/; the bed and the produced sweepers sit under /program/ as before.
 */
export const PROGRAM_URL = "/program/make/program.json";

/** A clip name → its url: the maker's clips are `slot-<seq>`; anything else is under /program. */
export const clipUrl = (clip: string) =>
  clip.startsWith("slot-") ? `/program/make/clips/${clip}.mp3` : `/program/${clip}.mp3`;

/** The one talk bed, a looped instrumental: /program/bed.mp3. */
export const BED = "bed";

/** The program clock starts here: 8:43:00 pm, as ms since midnight. */
export const PROGRAM_START_MS = (20 * 60 + 43) * 60 * 1000;
