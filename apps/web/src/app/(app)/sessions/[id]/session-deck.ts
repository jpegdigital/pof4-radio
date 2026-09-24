import { BrowserAudioEngine } from "@/lib/playback/browser-engine";
import { EMPTY, Player, type PlayerSnapshot } from "@/lib/playback/player";
import { acknowledgeVoice, loadSlot, playbackId } from "./load-slot";
import type { Cue, Slot } from "./types";

interface Snapshot {
  cue: Cue | null;
  playback: PlayerSnapshot;
}
const INITIAL: Snapshot = { cue: null, playback: EMPTY };

/** Wire the show's assets and acknowledgments to a player with an explicit mount lifetime. */
export class SessionDeck {
  private player: Player | null = null;
  private cue: Cue | null = null;
  private snapshot = INITIAL;
  private listeners = new Set<() => void>();
  private onSlot: (slot: Slot) => void = () => {};
  constructor(private sessionId: string) {}
  setSlotListener(listener: (slot: Slot) => void) {
    this.onSlot = listener;
  }
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private publish(playback: PlayerSnapshot) {
    this.snapshot = { cue: this.cue, playback };
    for (const listener of this.listeners) listener();
  }
  connect = () => {
    const player = new Player(new BrowserAudioEngine(), (slot) => {
      if (this.cue && playbackId(this.sessionId, this.cue) === slot.id)
        acknowledgeVoice(this.sessionId, this.cue);
    });
    this.player = player;
    const unsubscribe = player.subscribe(() => this.publish(player.getSnapshot()));
    return () => {
      unsubscribe();
      player.dispose();
      this.player = null;
      this.cue = null;
      this.publish(EMPTY);
    };
  };
  load = (cue: Cue) => {
    if (!this.player) return;
    this.cue = cue;
    this.player.load(playbackId(this.sessionId, cue), (signal) =>
      loadSlot(this.sessionId, cue, signal, (slot) => this.onSlot(slot)),
    );
  };
  unlock = () => this.player?.unlock();
  play = () => {
    const s = this.player?.getSnapshot();
    if (s?.phase === "failed" && !s.slot && this.cue) this.load(this.cue);
    else this.player?.play();
  };
  pause = () => this.player?.pause();
  toggle = () => {
    if (this.player?.getSnapshot().phase === "failed") this.play();
    else if (this.player?.getSnapshot().intent === "play") this.pause();
    else this.play();
  };
  seek = (ms: number) => this.player?.seek({ coordinate: "slot", ms }) ?? null;
  seekTrack = (ms: number) => this.player?.seek({ coordinate: "song", ms }) ?? null;
}
