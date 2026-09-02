import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "./server.mjs";
import ExcelJS from "exceljs";

test("LAN end-to-end: authentication, scope, progress, review, Excel, backup and restart", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "cvp-lan-"));
  let app = createApp({ dataDir: dir });
  let base;
  async function listen() {
    await new Promise((r) => app.server.listen(0, "127.0.0.1", r));
    base = "http://127.0.0.1:" + app.server.address().port;
  }
  await listen();
  async function call(p, method = "GET", data, cookie = "", status = 200) {
    const r = await fetch(base + "/api" + p, {
      method,
      headers: {
        ...(data !== undefined ? { "Content-Type": "application/json" } : {}),
        Cookie: cookie,
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    const result = await r.json();
    assert.equal(r.status, status, JSON.stringify(result));
    return { result, cookie: r.headers.get("set-cookie")?.split(";")[0] };
  }
  try {
    await call("/tasks", "GET", undefined, "", 401);
    await call(
      "/setup",
      "POST",
      { username: "admin", name: "Quản trị", password: "admin-test-123" },
      "",
      201,
    );
    await call(
      "/setup",
      "POST",
      { username: "admin", name: "x", password: "admin-test-123" },
      "",
      409,
    );
    await call(
      "/login",
      "POST",
      { username: "admin", password: "bad" },
      "",
      401,
    );
    const a = (
      await call("/login", "POST", {
        username: "admin",
        password: "admin-test-123",
      })
    ).cookie;
    const u1 = (
      await call(
        "/users",
        "POST",
        {
          username: "worker1",
          name: "Nhân viên 1",
          password: "worker-test-123",
        },
        a,
        201,
      )
    ).result.id;
    await call(
      "/users",
      "POST",
      { username: "worker2", name: "Nhân viên 2", password: "worker-test-123" },
      a,
      201,
    );
    const w = (
      await call("/login", "POST", {
        username: "worker1",
        password: "worker-test-123",
      })
    ).cookie;
    const w2 = (
      await call("/login", "POST", {
        username: "worker2",
        password: "worker-test-123",
      })
    ).cookie;
    await call("/users", "GET", undefined, w, 403);
    const task = {
      code: "TASK-1",
      title: "Kiểm tra hàng",
      assignee: u1,
      deadline: "2026-12-01T17:00:00+07:00",
      total: 100,
    };
    await call("/tasks", "POST", task, w, 403);
    const id = (await call("/tasks", "POST", task, a, 201)).result.id;
    await call("/tasks", "POST", task, a, 409);
    assert.equal((await call("/tasks", "GET", undefined, w2)).result.length, 0);
    await call("/tasks/" + id, "GET", undefined, w2, 403);
    await call(
      "/tasks/" + id + "/report",
      "POST",
      { done: 20, status: "IN_PROGRESS", version: 1 },
      w2,
      403,
    );
    await call(
      "/tasks/" + id + "/report",
      "POST",
      { done: 20, status: "BLOCKED", reason: "", version: 1 },
      w,
      400,
    );
    await call(
      "/tasks/" + id + "/report",
      "POST",
      { done: 20, status: "SUBMITTED", version: 1 },
      w,
      400,
    );
    await call(
      "/tasks/" + id + "/report",
      "POST",
      { done: 20, status: "BLOCKED", reason: "Thiếu hàng", version: 1 },
      w,
    );
    await call(
      "/tasks/" + id + "/report",
      "POST",
      { done: 50, status: "IN_PROGRESS", version: 1 },
      w,
      409,
    );
    const image =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5WQAAAAASUVORK5CYII=";
    await call(
      "/tasks/" + id + "/report",
      "POST",
      {
        done: 100,
        status: "SUBMITTED",
        version: 2,
        photos: [{ mime: "image/png", data: image }],
      },
      w,
    );
    const detail = (await call("/tasks/" + id, "GET", undefined, a)).result;
    assert.equal(detail.reports.length, 2);
    assert.equal(detail.photos.length, 1);
    assert.equal(
      (
        await fetch(base + "/api/photos/" + detail.photos[0].id, {
          headers: { Cookie: w2 },
        })
      ).status,
      403,
    );
    await call(
      "/tasks/" + id + "/review",
      "POST",
      { decision: "approve", version: 3 },
      w,
      403,
    );
    await call(
      "/tasks/" + id + "/review",
      "POST",
      { decision: "return", version: 3, note: "" },
      a,
      400,
    );
    await call(
      "/tasks/" + id + "/review",
      "POST",
      { decision: "return", version: 3, note: "Chụp lại ảnh" },
      a,
    );
    await call(
      "/tasks/" + id + "/report",
      "POST",
      { done: 100, status: "SUBMITTED", version: 4 },
      w,
    );
    await call(
      "/tasks/" + id + "/review",
      "POST",
      { decision: "approve", version: 5 },
      a,
    );
    await call(
      "/tasks/" + id + "/report",
      "POST",
      { done: 99, status: "IN_PROGRESS", version: 6 },
      w,
      409,
    );
    assert.equal(
      (await call("/tasks/" + id, "GET", undefined, w)).result.task.status,
      "DONE",
    );
    assert.ok((await call("/events", "GET", undefined, a)).result.length >= 3);
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Test").addRows([
      ["code", "title"],
      ["EX-1", "Test Excel"],
    ]);
    const preview = (
      await call(
        "/import/preview",
        "POST",
        { file: Buffer.from(await wb.xlsx.writeBuffer()).toString("base64") },
        a,
      )
    ).result;
    assert.equal(preview.rows[0][0], "EX-1");
    const imported = { ...task, username: "worker1", code: "EX-1" };
    await call(
      "/import/commit",
      "POST",
      { tasks: [imported, { ...imported, code: "TASK-1" }] },
      a,
      409,
    );
    assert.equal(
      (await call("/tasks", "GET", undefined, a)).result.length,
      1,
      "import must roll back all rows",
    );
    await call("/import/commit", "POST", { tasks: [imported] }, a, 201);
    await call("/import/commit", "POST", { tasks: [imported] }, w, 403);
    const csrf = await fetch(base + "/api/tasks", {
      method: "POST",
      headers: {
        Cookie: a,
        Origin: "http://evil.test",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(task),
    });
    assert.equal(csrf.status, 403);
    await call("/users/" + u1, "PATCH", { active: false }, a);
    await call("/me", "GET", undefined, w, 401);
    await call("/users/" + u1, "PATCH", { active: true }, a);
    const backup = await app.makeBackup();
    assert.ok(backup.endsWith(".sqlite"));
    await app.close();
    app = createApp({ dataDir: dir });
    await listen();
    assert.equal((await call("/tasks", "GET", undefined, a)).result.length, 2);
    await call(
      "/password",
      "POST",
      { current: "admin-test-123", password: "admin-new-123" },
      a,
    );
    await call("/me", "GET", undefined, a, 401);
  } finally {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("restore validates database, keeps safety copy and invalidates sessions", async () => {
  const { copyFileSync, readdirSync } = await import("node:fs");
  const { execFileSync } = await import("node:child_process");
  const root = mkdtempSync(path.join(tmpdir(), "cvp-restore-")),
    dataDir = path.join(root, "data");
  const app = createApp({ dataDir });
  app.db
    .prepare("INSERT INTO users VALUES(?,?,?,?,?,?)")
    .run("u", "admin", "Admin", "ADMIN", "test-hash", 1);
  app.db
    .prepare("INSERT INTO sessions VALUES(?,?,?)")
    .run("session", "u", Date.now() + 999999);
  const file = await app.makeBackup();
  await app.close();
  copyFileSync(
    new URL("./restore.mjs", import.meta.url),
    path.join(root, "restore.mjs"),
  );
  execFileSync(process.execPath, [
    path.join(root, "restore.mjs"),
    file,
    "--confirm",
  ]);
  const restored = createApp({ dataDir });
  assert.equal(
    restored.db.prepare("SELECT count(*) n FROM sessions").get().n,
    0,
  );
  assert.equal(restored.db.prepare("SELECT count(*) n FROM users").get().n, 1);
  assert.ok(readdirSync(dataDir).some((n) => n.includes("before-restore")));
  await restored.close();
  rmSync(root, { recursive: true, force: true });
});
