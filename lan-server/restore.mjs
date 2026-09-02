import { DatabaseSync } from "node:sqlite";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const source = process.argv[2];
if (!source || process.argv[3] !== "--confirm") {
  console.error(
    'Dung may chu truoc. Dung: node restore.mjs "duong-dan-backup.sqlite" --confirm',
  );
  process.exit(1);
}
const target = path.join(root, "data", "congviec.sqlite");
if (path.resolve(source) === target)
  throw new Error("Khong chon chinh database dang dung.");
const check = new DatabaseSync(source, { readOnly: true });
if (check.prepare("PRAGMA integrity_check").get().integrity_check !== "ok")
  throw new Error("Backup hong.");
if (check.prepare("PRAGMA user_version").get().user_version !== 1)
  throw new Error("Khong dung phien ban backup.");
for (const table of [
  "users",
  "sessions",
  "tasks",
  "reports",
  "photos",
  "events",
  "audit",
])
  check.prepare(`SELECT * FROM ${table} LIMIT 0`).all();
check.close();
// Refuse while WAL exists: stop the server normally to checkpoint and remove it.
if (existsSync(target + "-wal") || existsSync(target + "-shm"))
  throw new Error(
    "Database con dang mo hoac chua dong sach. Mo lai may chu va dung bang Ctrl+C truoc khi restore.",
  );
mkdirSync(path.dirname(target), { recursive: true });
const stage = target + ".restore";
copyFileSync(source, stage);
const clean = new DatabaseSync(stage);
clean.exec("DELETE FROM sessions; PRAGMA wal_checkpoint(TRUNCATE)");
clean.close();
if (existsSync(target))
  copyFileSync(target, target + ".before-restore-" + Date.now());
renameSync(stage, target);
console.log("Da khoi phuc. Tat ca tai khoan can dang nhap lai.");
