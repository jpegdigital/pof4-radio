/** Model-facing field descriptions; output validation remains with the domain schemas. */
export const descriptions = {
  artist: "the artist",
  title: "the song — a title as you know it",
  why: "Your programming note: one musical or editorial reason for playing this song here in your show. Do not describe fulfilling a request or refer to a user or prompt.",
  words:
    "Spoken copy within the supplied word budget. No legal ID or lyrics. Include inline ElevenLabs emotion tags only when the brief enables them; no other stage directions. Empty only for a segue.",
  leadLine:
    "The break's final sentence introducing the recording, within its separate word budget. Empty for all other kinds.",
} as const;
