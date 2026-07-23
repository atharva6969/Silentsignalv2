import type Database from "better-sqlite3";
import { generateSeedNotes } from "./ai.ts";

export async function seedUserNotes(db: Database.Database, userId: number, username: string) {
  const existing = db.prepare("SELECT COUNT(*) as c FROM notes WHERE user_id = ?").get(userId) as { c: number };
  if (existing.c > 0) return;

  const notes = await generateSeedNotes(username);
  const insert = db.prepare("INSERT INTO notes (user_id, title, content) VALUES (?, ?, ?)");
  for (const note of notes) {
    insert.run(userId, note.title, note.content);
  }
  console.log(`[✓ SEED] Added ${notes.length} decoy notes for user ${username}`);
}
