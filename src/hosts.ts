import { readFileSync, statSync } from "node:fs";
import { z } from "zod";

export type Role = "admin" | "host";

const fileSchema = z.object({
  admins: z.array(z.string()).default([]),
  hosts: z.array(z.string()).default([]),
});
type Lists = z.infer<typeof fileSchema>;

const norm = (e: string) => e.trim().toLowerCase();

/**
 * Who may log in as a host or admin. Backed by a JSON file that is re-read whenever it changes,
 * so adding a host needs no restart. If the file is edited into something invalid, the last good list stays in force.
 */
export class HostDirectory {
  private roles = new Map<string, Role>();
  private stamp = -1;

  private constructor(
    private statFn: () => number,
    private loadFn: () => Lists,
  ) {
    this.refresh(true);
  }

  static fromFile(path: string) {
    return new HostDirectory(
      () => statSync(path).mtimeMs,
      () => fileSchema.parse(JSON.parse(readFileSync(path, "utf8"))),
    );
  }

  static fromLists(lists: Partial<Lists>) {
    return new HostDirectory(() => 0, () => fileSchema.parse(lists));
  }

  private refresh(strict = false) {
    let stamp: number;
    try {
      stamp = this.statFn();
    } catch (e) {
      if (strict) throw e;
      return;
    }
    if (stamp === this.stamp) return;
    this.stamp = stamp;
    try {
      const lists = this.loadFn();
      const roles = new Map<string, Role>();
      for (const e of lists.hosts) roles.set(norm(e), "host");
      for (const e of lists.admins) roles.set(norm(e), "admin");
      this.roles = roles;
    } catch (e) {
      if (strict) throw e;
      console.error("hosts file is invalid, keeping the previous list:", (e as Error).message);
    }
  }

  roleOf(email: string): Role | null {
    this.refresh();
    return this.roles.get(norm(email)) ?? null;
  }

  list(): { email: string; role: Role }[] {
    this.refresh();
    return [...this.roles].map(([email, role]) => ({ email, role }));
  }
}
