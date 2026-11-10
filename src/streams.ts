import type { ServerResponse } from "node:http";

/** A team shares one player across its phones, so this is per team, with room for reloads. */
export const MAX_STREAMS_PER_VIEWER = 20;
export const MAX_STREAMS_PER_GAME = 600;

/** Every open live-update connection, so they can be counted, capped, and closed (a removed player, a shutdown). */
export class Streams {
  private byViewer = new Map<string, Set<ServerResponse>>();
  private perGame = new Map<string, number>();

  private key = (gameId: string, viewer: string) => `${gameId}|${viewer}`;

  /** False when this viewer, or this game, already holds as many connections as allowed. */
  hasRoom(gameId: string, viewer: string): boolean {
    return (this.byViewer.get(this.key(gameId, viewer))?.size ?? 0) < MAX_STREAMS_PER_VIEWER && (this.perGame.get(gameId) ?? 0) < MAX_STREAMS_PER_GAME;
  }

  add(gameId: string, viewer: string, res: ServerResponse): () => void {
    const k = this.key(gameId, viewer);
    let set = this.byViewer.get(k);
    if (!set) this.byViewer.set(k, (set = new Set()));
    set.add(res);
    this.perGame.set(gameId, (this.perGame.get(gameId) ?? 0) + 1);
    let gone = false;
    return () => {
      if (gone) return;
      gone = true;
      set.delete(res);
      if (!set.size && this.byViewer.get(k) === set) this.byViewer.delete(k);
      const n = (this.perGame.get(gameId) ?? 1) - 1;
      if (n > 0) this.perGame.set(gameId, n);
      else this.perGame.delete(gameId);
    };
  }

  /** Ends one viewer's connections; their pages notice and ask again, and are then told where they stand. */
  closeViewer(gameId: string, viewer: string): void {
    for (const res of [...(this.byViewer.get(this.key(gameId, viewer)) ?? [])]) res.end();
  }

  closeAll(): void {
    for (const set of [...this.byViewer.values()]) for (const res of [...set]) res.end();
  }

  get open(): number {
    let n = 0;
    for (const v of this.perGame.values()) n += v;
    return n;
  }
}
