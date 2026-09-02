import http from "node:http";
import { DatabaseSync, backup } from "node:sqlite";
import {
  randomBytes,
  scryptSync,
  timingSafeEqual,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  readFileSync,
  existsSync,
  readdirSync,
  unlinkSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import ExcelJS from "exceljs";

const root = path.dirname(fileURLToPath(import.meta.url));
const hash = (s) => createHash("sha256").update(s).digest("hex");
const uid = () => randomBytes(16).toString("hex");
const now = () => new Date().toISOString();
const fail = (status, message) => {
  throw Object.assign(new Error(message), { status });
};
const text = (v, max = 2000) =>
  String(v ?? "")
    .trim()
    .slice(0, max);
const passwordHash = (p) => {
  const salt = uid();
  return salt + ":" + scryptSync(p, salt, 64).toString("hex");
};
const passwordOK = (p, s) => {
  const [salt, h] = s.split(":");
  return timingSafeEqual(scryptSync(p, salt, 64), Buffer.from(h, "hex"));
};
function validPassword(p) {
  if (typeof p !== "string" || p.length < 10 || p.length > 128)
    fail(400, "Mật khẩu cần 10–128 ký tự.");
}
const publicUser = ({ id, username, name, role, active }) => ({
  id,
  username,
  name,
  role,
  active,
});

export function createApp({ dataDir = path.join(root, "data") } = {}) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, "congviec.sqlite"));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
 CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')), password TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
 CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,code TEXT UNIQUE NOT NULL,title TEXT NOT NULL,description TEXT NOT NULL,assignee TEXT REFERENCES users(id),deadline TEXT NOT NULL,total REAL NOT NULL,done REAL NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'TODO',reason TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created TEXT NOT NULL,updated TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS reports(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id),user_id TEXT REFERENCES users(id),note TEXT NOT NULL,reason TEXT NOT NULL,done REAL NOT NULL,status TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS photos(id TEXT PRIMARY KEY,task_id TEXT REFERENCES tasks(id),report_id TEXT REFERENCES reports(id),mime TEXT NOT NULL,data BLOB NOT NULL);
 CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,task_id TEXT,user_id TEXT,title TEXT NOT NULL,created TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT,action TEXT NOT NULL,task_id TEXT,data TEXT NOT NULL,created TEXT NOT NULL);
 PRAGMA user_version=1;`);
  const one = (q, ...p) => db.prepare(q).get(...p),
    all = (q, ...p) => db.prepare(q).all(...p),
    run = (q, ...p) => db.prepare(q).run(...p);
  const tx = (fn) => {
    db.exec("BEGIN IMMEDIATE");
    try {
      const r = fn();
      db.exec("COMMIT");
      return r;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  };
  const audit = (u, action, tid, data) =>
    run(
      "INSERT INTO audit(actor,action,task_id,data,created) VALUES(?,?,?,?,?)",
      u.id,
      action,
      tid,
      JSON.stringify(data),
      now(),
    );
  const event = (tid, user, title) =>
    run(
      "INSERT INTO events(task_id,user_id,title,created) VALUES(?,?,?,?)",
      tid,
      user,
      title,
      now(),
    );
  const alertAdmins = (tid, title) =>
    all("SELECT id FROM users WHERE role='ADMIN' AND active=1").forEach((u) =>
      event(tid, u.id, title),
    );
  const taskFor = (u, id) => {
    const t = one("SELECT * FROM tasks WHERE id=?", id);
    if (!t) fail(404, "Không tìm thấy công việc.");
    if (u.role !== "ADMIN" && t.assignee !== u.id)
      fail(403, "Bạn không được xem công việc này.");
    return t;
  };
  const admin = (u) => {
    if (u.role !== "ADMIN") fail(403, "Chỉ quản trị được thực hiện.");
  };
  const attempts = new Map();
  async function body(req) {
    if (!(req.headers["content-type"] || "").startsWith("application/json"))
      fail(415, "Yêu cầu JSON.");
    let n = 0,
      chunks = [];
    for await (const chunk of req) {
      n += chunk.length;
      if (n > 12 * 1024 * 1024) fail(413, "Dữ liệu quá lớn (tối đa 12 MB).");
      chunks.push(chunk);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString());
    } catch {
      fail(400, "Dữ liệu JSON không hợp lệ.");
    }
  }
  const validateTask = (b) => {
    const code = text(b.code, 80),
      title = text(b.title, 240),
      description = text(b.description),
      assignee = text(b.assignee, 80),
      deadline = text(b.deadline, 40),
      total = Number(b.total);
    if (
      !code ||
      !title ||
      !assignee ||
      !deadline ||
      !Number.isFinite(Date.parse(deadline)) ||
      !Number.isFinite(total) ||
      total <= 0 ||
      total > 1e9
    )
      fail(400, "Thiếu mã, tên, người nhận, hạn hoặc số lượng hợp lệ.");
    const user = one(
      "SELECT * FROM users WHERE id=? AND active=1 AND role='USER'",
      assignee,
    );
    if (!user) fail(400, "Người nhận phải là nhân viên đang hoạt động.");
    return {
      code,
      title,
      description,
      assignee,
      deadline: new Date(deadline).toISOString(),
      total,
    };
  };
  const addTask = (u, b) => {
    const t = validateTask(b);
    if (one("SELECT id FROM tasks WHERE code=?", t.code))
      fail(409, "Trùng mã công việc: " + t.code);
    const id = uid(),
      date = now();
    run(
      "INSERT INTO tasks(id,code,title,description,assignee,deadline,total,created,updated) VALUES(?,?,?,?,?,?,?,?,?)",
      id,
      t.code,
      t.title,
      t.description,
      t.assignee,
      t.deadline,
      t.total,
      date,
      date,
    );
    audit(u, "CREATE", id, t);
    event(id, t.assignee, "Việc mới: " + t.title);
    return id;
  };
  let backupBusy = false;
  async function makeBackup() {
    if (backupBusy) fail(409, "Đang sao lưu.");
    backupBusy = true;
    try {
      const dir = path.join(dataDir, "backups");
      mkdirSync(dir, { recursive: true });
      const name = "congviec-" + Date.now() + ".sqlite";
      await backup(db, path.join(dir, name));
      const old = readdirSync(dir)
        .filter((n) => /^congviec-\d+\.sqlite$/.test(n))
        .sort()
        .slice(0, -7);
      old.forEach((n) => unlinkSync(path.join(dir, n)));
      return path.join(dir, name);
    } finally {
      backupBusy = false;
    }
  }
  const server = http.createServer(async (req, res) => {
    const send = (status, data, headers = {}) => {
      res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        ...headers,
      });
      res.end(JSON.stringify(data));
    };
    try {
      const url = new URL(req.url, "http://localhost"),
        p = url.pathname;
      if (!p.startsWith("/api/")) {
        const files = {
          "/": "index.html",
          "/app.js": "app.js",
          "/style.css": "style.css",
        };
        const name = files[p];
        if (!name) fail(404, "Không tìm thấy.");
        res.writeHead(200, {
          "Content-Type": name.endsWith(".js")
            ? "text/javascript; charset=utf-8"
            : name.endsWith(".css")
              ? "text/css; charset=utf-8"
              : "text/html; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-store",
          "Content-Security-Policy":
            "default-src 'self'; img-src 'self' blob: data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
        });
        res.end(readFileSync(path.join(root, "public", name)));
        return;
      }
      if (
        req.headers.origin &&
        req.headers.origin !== `http://${req.headers.host}` &&
        req.headers.origin !== `https://${req.headers.host}`
      )
        fail(403, "Nguồn truy cập không được phép.");
      if (req.method === "GET" && p === "/api/status")
        return send(200, {
          setup: !one("SELECT id FROM users LIMIT 1"),
          version: "0.1.0",
          local: ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          ),
        });
      if (req.method === "POST" && p === "/api/setup") {
        if (
          !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(
            req.socket.remoteAddress,
          )
        )
          fail(403, "Tạo quản trị trên chính máy chủ qua localhost.");
        if (one("SELECT id FROM users LIMIT 1"))
          fail(409, "Đã thiết lập quản trị.");
        const b = await body(req);
        validPassword(b.password);
        const username = text(b.username, 60).toLowerCase();
        if (!/^[a-z0-9_.-]{3,60}$/.test(username) || !text(b.name, 100))
          fail(400, "Tên đăng nhập 3–60 ký tự: a-z, số, dấu chấm, gạch.");
        tx(() => {
          if (one("SELECT id FROM users LIMIT 1"))
            fail(409, "Đã thiết lập quản trị.");
          run(
            "INSERT INTO users(id,username,name,role,password) VALUES(?,?,?,?,?)",
            uid(),
            username,
            text(b.name, 100),
            "ADMIN",
            passwordHash(b.password),
          );
        });
        return send(201, { ok: true });
      }
      if (req.method === "POST" && p === "/api/login") {
        const key = req.socket.remoteAddress;
        const a = attempts.get(key) || { n: 0, until: Date.now() + 600000 };
        if (a.until < Date.now()) {
          a.n = 0;
          a.until = Date.now() + 600000;
        }
        if (a.n >= 15) fail(429, "Thử đăng nhập quá nhiều. Chờ 10 phút.");
        a.n++;
        attempts.set(key, a);
        const b = await body(req);
        if (typeof b.password !== "string" || b.password.length > 128)
          fail(401, "Sai tài khoản hoặc mật khẩu.");
        const u = one(
          "SELECT * FROM users WHERE username=? AND active=1",
          text(b.username, 60).toLowerCase(),
        );
        if (!u || !passwordOK(b.password, u.password))
          fail(401, "Sai tài khoản hoặc mật khẩu.");
        attempts.delete(key);
        const token = uid() + uid();
        run("DELETE FROM sessions WHERE expires<?", Date.now());
        run(
          "INSERT INTO sessions VALUES(?,?,?)",
          hash(token),
          u.id,
          Date.now() + 12 * 3600000,
        );
        return send(200, publicUser(u), {
          "Set-Cookie": `cvp=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200`,
        });
      }
      const token =
        (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("cvp="))
          ?.slice(4) || "";
      const u = one(
        "SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=? AND s.expires>? AND u.active=1",
        hash(token),
        Date.now(),
      );
      if (!u) fail(401, "Vui lòng đăng nhập.");
      if (p === "/api/me" && req.method === "GET")
        return send(200, publicUser(u));
      if (p === "/api/logout" && req.method === "POST") {
        run("DELETE FROM sessions WHERE token=?", hash(token));
        return send(
          200,
          { ok: true },
          {
            "Set-Cookie": "cvp=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
          },
        );
      }
      if (p === "/api/password" && req.method === "POST") {
        const b = await body(req);
        if (
          typeof b.current !== "string" ||
          b.current.length > 128 ||
          !passwordOK(b.current, u.password)
        )
          fail(403, "Mật khẩu hiện tại không đúng.");
        validPassword(b.password);
        tx(() => {
          run(
            "UPDATE users SET password=? WHERE id=?",
            passwordHash(b.password),
            u.id,
          );
          run("DELETE FROM sessions WHERE user_id=?", u.id);
          audit(u, "PASSWORD", null, {});
        });
        return send(200, { ok: true });
      }
      if (p === "/api/users" && req.method === "GET") {
        admin(u);
        return send(
          200,
          all("SELECT id,username,name,role,active FROM users ORDER BY name"),
        );
      }
      if (p === "/api/users" && req.method === "POST") {
        admin(u);
        const b = await body(req);
        validPassword(b.password);
        const username = text(b.username, 60).toLowerCase(),
          name = text(b.name, 100);
        if (!/^[a-z0-9_.-]{3,60}$/.test(username) || !name)
          fail(400, "Tên đăng nhập hoặc họ tên không hợp lệ.");
        if (one("SELECT id FROM users WHERE username=?", username))
          fail(409, "Tên đăng nhập đã tồn tại.");
        const id = uid();
        tx(() => {
          run(
            "INSERT INTO users(id,username,name,role,password) VALUES(?,?,?,?,?)",
            id,
            username,
            name,
            "USER",
            passwordHash(b.password),
          );
          audit(u, "CREATE_USER", null, { id, username, name });
        });
        return send(201, { id });
      }
      if (/^\/api\/users\/[^/]+$/.test(p) && req.method === "PATCH") {
        admin(u);
        const id = p.split("/")[3],
          target = one("SELECT * FROM users WHERE id=?", id);
        if (!target) fail(404, "Không có tài khoản.");
        if (target.role === "ADMIN")
          fail(400, "Không khóa quản trị trong bản thử nghiệm.");
        const b = await body(req);
        if (typeof b.active !== "boolean")
          fail(400, "Trạng thái không hợp lệ.");
        tx(() => {
          run("UPDATE users SET active=? WHERE id=?", Number(b.active), id);
          run("DELETE FROM sessions WHERE user_id=?", id);
          audit(u, "USER_ACTIVE", null, { id, active: b.active });
        });
        return send(200, { ok: true });
      }
      if (p === "/api/tasks" && req.method === "GET")
        return send(
          200,
          all(
            `SELECT t.*,u.name assignee_name,u.username FROM tasks t JOIN users u ON t.assignee=u.id ${u.role === "ADMIN" ? "" : "WHERE t.assignee=?"} ORDER BY t.created DESC`,
            ...(u.role === "ADMIN" ? [] : [u.id]),
          ),
        );
      if (p === "/api/tasks" && req.method === "POST") {
        admin(u);
        const b = await body(req);
        const id = tx(() => addTask(u, b));
        return send(201, { id });
      }
      const match = p.match(/^\/api\/tasks\/([^/]+)(?:\/(report|review))?$/);
      if (match) {
        let t = taskFor(u, match[1]);
        if (req.method === "GET" && !match[2])
          return send(200, {
            task: t,
            reports: all(
              "SELECT r.*,u.name FROM reports r JOIN users u ON r.user_id=u.id WHERE task_id=? ORDER BY created DESC",
              t.id,
            ),
            photos: all(
              "SELECT id,report_id FROM photos WHERE task_id=?",
              t.id,
            ),
            audit: all(
              "SELECT a.*,u.name FROM audit a LEFT JOIN users u ON u.id=a.actor WHERE task_id=? ORDER BY a.id DESC",
              t.id,
            ),
          });
        if (req.method === "POST" && match[2] === "report") {
          if (u.role !== "USER" || t.assignee !== u.id)
            fail(403, "Chỉ nhân viên được giao mới báo cáo.");
          const b = await body(req);
          t = taskFor(u, match[1]);
          if (b.version !== t.version)
            fail(409, "Công việc đã thay đổi. Tải lại trước khi gửi.");
          if (["DONE", "SUBMITTED"].includes(t.status))
            fail(409, "Việc đã hoàn thành hoặc đang chờ duyệt.");
          const done = Number(b.done),
            status = text(b.status, 20),
            note = text(b.note),
            reason = text(b.reason);
          if (
            !["IN_PROGRESS", "BLOCKED", "SUBMITTED"].includes(status) ||
            !Number.isFinite(done) ||
            done < 0 ||
            done > t.total
          )
            fail(400, "Tiến độ không hợp lệ.");
          if (status === "BLOCKED" && !reason)
            fail(400, "Cần lý do chưa hoàn thành.");
          if (status === "SUBMITTED" && done !== t.total)
            fail(400, "Hoàn thành đủ số lượng trước khi gửi duyệt.");
          const photos = Array.isArray(b.photos) ? b.photos : [];
          if (photos.length > 3) fail(400, "Tối đa 3 ảnh mỗi báo cáo.");
          const pictures = photos.map((p) => {
            if (
              !["image/jpeg", "image/png"].includes(p.mime) ||
              typeof p.data !== "string"
            )
              fail(400, "Chỉ nhận JPG/PNG.");
            const data = Buffer.from(p.data, "base64");
            if (data.length > 2 * 1024 * 1024 || data.length < 8)
              fail(400, "Mỗi ảnh tối đa 2 MB.");
            if (
              (p.mime === "image/jpeg" &&
                data.subarray(0, 3).toString("hex") !== "ffd8ff") ||
              (p.mime === "image/png" &&
                data.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
            )
              fail(400, "Ảnh không hợp lệ.");
            return { data, mime: p.mime };
          });
          tx(() => {
            const id = uid(),
              date = now();
            run(
              "INSERT INTO reports VALUES(?,?,?,?,?,?,?,?)",
              id,
              t.id,
              u.id,
              note,
              reason,
              done,
              status,
              date,
            );
            pictures.forEach((pic) =>
              run(
                "INSERT INTO photos VALUES(?,?,?,?,?)",
                uid(),
                t.id,
                id,
                pic.mime,
                pic.data,
              ),
            );
            run(
              "UPDATE tasks SET done=?,status=?,reason=?,version=version+1,updated=? WHERE id=?",
              done,
              status,
              reason,
              date,
              t.id,
            );
            audit(u, "REPORT", t.id, { done, status, note, reason });
            alertAdmins(
              t.id,
              `${u.name}: ${t.title} · ${Math.round((done / t.total) * 100)}%${status === "SUBMITTED" ? " · Chờ duyệt" : status === "BLOCKED" ? " · Đang vướng" : ""}`,
            );
          });
          return send(200, { ok: true });
        }
        if (req.method === "POST" && match[2] === "review") {
          admin(u);
          const b = await body(req);
          t = taskFor(u, match[1]);
          if (b.version !== t.version)
            fail(409, "Công việc đã thay đổi. Tải lại.");
          if (t.status !== "SUBMITTED") fail(409, "Công việc chưa gửi duyệt.");
          if (!["approve", "return"].includes(b.decision))
            fail(400, "Quyết định không hợp lệ.");
          const note = text(b.note);
          if (b.decision === "return" && !note)
            fail(400, "Cần ghi lý do yêu cầu làm lại.");
          tx(() => {
            run(
              "UPDATE tasks SET status=?,reason=?,version=version+1,updated=? WHERE id=?",
              b.decision === "approve" ? "DONE" : "IN_PROGRESS",
              note,
              now(),
              t.id,
            );
            audit(u, "REVIEW", t.id, { decision: b.decision, note });
            event(
              t.id,
              t.assignee,
              (b.decision === "approve" ? "Đã duyệt: " : "Yêu cầu làm lại: ") +
                t.title,
            );
          });
          return send(200, { ok: true });
        }
      }
      if (p.startsWith("/api/photos/") && req.method === "GET") {
        const pic = one("SELECT * FROM photos WHERE id=?", p.split("/")[3]);
        if (!pic) fail(404, "Không có ảnh.");
        taskFor(u, pic.task_id);
        res.writeHead(200, {
          "Content-Type": pic.mime,
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        });
        res.end(Buffer.from(pic.data));
        return;
      }
      if (p === "/api/events" && req.method === "GET") {
        const after = Math.max(0, Number(url.searchParams.get("after")) || 0);
        return send(
          200,
          all(
            "SELECT * FROM events WHERE user_id=? AND id>? ORDER BY id LIMIT 100",
            u.id,
            after,
          ),
        );
      }
      if (p === "/api/template" && req.method === "GET") {
        admin(u);
        const wb = new ExcelJS.Workbook(),
          s = wb.addWorksheet("Giao viec");
        s.addRow([
          "Ma viec",
          "Ten viec",
          "Tai khoan",
          "Han hoan thanh",
          "So luong",
          "Mo ta",
        ]);
        s.addRow([
          "VIEC-001",
          "Kiem tra hang xuat",
          "nhanvien01",
          "2026-12-01 17:00",
          100,
          "Du lieu mau - sua truoc khi nhap",
        ]);
        s.columns.forEach((c) => (c.width = 26));
        s.getRow(1).font = { bold: true };
        const data = await wb.xlsx.writeBuffer();
        res.writeHead(200, {
          "Content-Type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": 'attachment; filename="mau-giao-viec.xlsx"',
        });
        res.end(Buffer.from(data));
        return;
      }
      if (p === "/api/import/preview" && req.method === "POST") {
        admin(u);
        const b = await body(req);
        if (typeof b.file !== "string" || b.file.length > 7e6)
          fail(400, "File XLSX tối đa 5 MB.");
        const wb = new ExcelJS.Workbook();
        try {
          await wb.xlsx.load(Buffer.from(b.file, "base64"));
        } catch {
          fail(400, "Không đọc được XLSX.");
        }
        const sheet = wb.worksheets[0];
        if (!sheet || sheet.rowCount > 501 || sheet.columnCount > 50)
          fail(400, "Dùng sheet đầu tiên, tối đa 500 dòng và 50 cột.");
        const cell = (v) =>
          v instanceof Date
            ? v.toISOString().slice(0, 19)
            : v && typeof v === "object"
              ? String(
                  v.text ??
                    v.result ??
                    v.richText?.map((x) => x.text).join("") ??
                    "",
                )
              : String(v ?? "");
        const rows = [];
        sheet.eachRow({ includeEmpty: true }, (r) =>
          rows.push(
            Array.from({ length: sheet.columnCount }, (_, i) =>
              cell(r.getCell(i + 1).value),
            ),
          ),
        );
        return send(200, { headers: rows[0] || [], rows: rows.slice(1) });
      }
      if (p === "/api/import/commit" && req.method === "POST") {
        admin(u);
        const b = await body(req);
        if (!Array.isArray(b.tasks) || !b.tasks.length || b.tasks.length > 500)
          fail(400, "Nhập 1–500 công việc.");
        const result = tx(() =>
          b.tasks.map((t, i) => {
            const person = one(
              "SELECT id FROM users WHERE username=?",
              text(t.username, 60).toLowerCase(),
            );
            try {
              return addTask(u, { ...t, assignee: person?.id });
            } catch (e) {
              fail(e.status || 400, `Dòng ${i + 2}: ${e.message}`);
            }
          }),
        );
        return send(201, { count: result.length });
      }
      if (p === "/api/backup" && req.method === "POST") {
        admin(u);
        await body(req);
        const file = await makeBackup();
        res.writeHead(200, {
          "Content-Type": "application/octet-stream",
          "Content-Disposition": `attachment; filename="${path.basename(file)}"`,
        });
        res.end(readFileSync(file));
        return;
      }
      fail(404, "Không tìm thấy chức năng.");
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent)
        send(e.status || 500, {
          error: e.status
            ? e.message
            : "Lỗi máy chủ. Kiểm tra nhật ký máy chủ.",
        });
      else res.end();
    }
  });
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  const timer = setInterval(
    () => makeBackup().catch(console.error),
    6 * 3600000,
  );
  timer.unref();
  return {
    server,
    db,
    makeBackup,
    close: async () => {
      clearInterval(timer);
      server.closeAllConnections();
      await new Promise((r) => server.close(r));
      db.close();
    },
  };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const app = createApp();
  const port = Number(process.env.PORT || 8080);
  app.server.listen(port, "0.0.0.0", () => {
    console.log(`CongViecPro LAN - tren may chu: http://localhost:${port}`);
    try {
      for (const values of Object.values(os.networkInterfaces()))
        for (const a of values || [])
          if (a.family === "IPv4" && !a.internal)
            console.log(`Dien thoai cung Wi-Fi: http://${a.address}:${port}`);
    } catch {}
    console.log("Dung du lieu gia de thu nghiem. Nhan Ctrl+C de dung.");
  });
  process.on("SIGINT", async () => {
    await app.close();
    process.exit(0);
  });
}
