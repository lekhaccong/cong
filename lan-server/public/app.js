const $ = (s) => document.querySelector(s),
  app = $("#app"),
  notice = $("#notice"),
  dialog = $("#detail");
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const labels = {
  TODO: "Chưa bắt đầu",
  IN_PROGRESS: "Đang làm",
  BLOCKED: "Đang vướng",
  SUBMITTED: "Chờ duyệt",
  DONE: "Hoàn thành",
};
let me = null,
  users = [],
  tasks = [],
  filter = "",
  cursor = 0,
  events = [],
  polling = false;
const date = (v) => (v ? new Date(v).toLocaleString("vi-VN") : "—");
const msg = (s) => (notice.textContent = s);
async function api(url, method = "GET", data) {
  const res = await fetch("/api" + url, {
    method,
    headers: data !== undefined ? { "Content-Type": "application/json" } : {},
    body: data !== undefined ? JSON.stringify(data) : undefined,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Không kết nối được máy chủ");
  return body;
}
function formData(f) {
  return Object.fromEntries(new FormData(f));
}
function bindForm(id, fn) {
  const f = $(id);
  if (!f) return;
  f.addEventListener("submit", async (e) => {
    e.preventDefault();
    const buttons = [...f.querySelectorAll("button")];
    buttons.forEach((b) => (b.disabled = true));
    try {
      await fn(formData(f), f);
    } catch (err) {
      msg(err.message);
      if (dialog.open) {
        let el = dialog.querySelector(".form-error");
        if (!el) {
          el = document.createElement("p");
          el.className = "form-error error";
          el.setAttribute("role", "alert");
          dialog.appendChild(el);
        }
        el.textContent = err.message;
      }
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
}
function modal(html) {
  dialog.innerHTML =
    '<button class="close secondary" id="close">Đóng</button>' + html;
  $("#close").onclick = () => dialog.close();
  if (!dialog.open) dialog.showModal();
}
async function boot() {
  try {
    me = await api("/me");
    await dashboard();
  } catch {
    await login();
  }
}
async function login() {
  me = null;
  $("#identity").textContent = "";
  const state = await api("/status");
  app.innerHTML = `<section class="auth"><span class="badge">Bản thử nghiệm tại nhà</span><h1>${state.setup ? "Tạo quản trị đầu tiên" : "Đăng nhập hệ thống"}</h1><p class="muted">Dữ liệu dùng chung trên máy chủ nội bộ.</p>${state.setup && !state.local ? "<p>Mở http://localhost:8080 trên máy chủ để tạo quản trị trước.</p>" : `<form id="login">${state.setup ? '<label>Họ tên<input name="name" required maxlength="100"></label>' : ""}<label>Tài khoản<input name="username" required autocomplete="username" pattern="[a-zA-Z0-9_.-]{3,60}"></label><label>Mật khẩu<input name="password" type="password" required minlength="10" maxlength="128" autocomplete="${state.setup ? "new-password" : "current-password"}"></label><button>${state.setup ? "Tạo quản trị" : "Đăng nhập"}</button></form>`}<p class="hint">Chỉ sử dụng dữ liệu giả trong bản thử nghiệm HTTP này.</p></section>`;
  bindForm("#login", async (b) => {
    if (state.setup) await api("/setup", "POST", b);
    me = await api("/login", "POST", b);
    cursor = 0;
    events = [];
    msg("Đã đăng nhập.");
    await dashboard();
  });
}
async function load() {
  tasks = await api("/tasks");
  if (me.role === "ADMIN") users = await api("/users");
}
async function dashboard() {
  await load();
  $("#identity").innerHTML =
    `${esc(me.name)} · ${me.role === "ADMIN" ? "Quản trị" : "Nhân viên"} <button id="logout" class="secondary">Đăng xuất</button>`;
  $("#logout").onclick = async () => {
    await api("/logout", "POST", {});
    dialog.close();
    await login();
  };
  app.innerHTML = `<h1>${me.role === "ADMIN" ? "Điều hành công việc" : "Công việc của tôi"}</h1><p class="muted" id="connection">Đã kết nối · Tự cập nhật mỗi 5 giây</p><div class="stats" id="stats"></div><div class="toolbar">${me.role === "ADMIN" ? '<button id="new">+ Giao việc</button><button class="secondary" id="people">Nhân viên</button><button class="secondary" id="excel">Nhập Excel</button><button class="secondary" id="backup">Sao lưu</button>' : ""}<button class="secondary" id="password">Đổi mật khẩu</button><button class="secondary" id="refresh">Làm mới</button></div><label>Lọc trạng thái<select id="filter"><option value="">Tất cả công việc</option>${Object.entries(
    labels,
  )
    .map(([k, v]) => `<option value="${k}">${v}</option>`)
    .join(
      "",
    )}</select></label><div id="tasks" class="grid"></div><section><h2>Thông báo</h2><p class="hint">Cập nhật khi trang đang mở và có kết nối. Chưa gửi thông báo khi đóng trình duyệt.</p><div class="events" id="events"></div></section>`;
  $("#filter").value = filter;
  $("#filter").onchange = (e) => {
    filter = e.target.value;
    renderTasks();
  };
  $("#refresh").onclick = () => dashboard().catch((e) => msg(e.message));
  $("#password").onclick = passwordForm;
  if (me.role === "ADMIN") {
    $("#new").onclick = newTask;
    $("#people").onclick = people;
    $("#excel").onclick = excel;
    $("#backup").onclick = async () => {
      try {
        const r = await fetch("/api/backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        if (!r.ok) throw new Error((await r.json()).error);
        download(await r.blob(), "congviec-backup-" + Date.now() + ".sqlite");
        msg("Đã tạo bản sao. Giữ file tại nơi riêng an toàn.");
      } catch (e) {
        msg(e.message);
      }
    };
  }
  renderTasks();
  renderEvents();
}
function renderTasks() {
  const count = (s) => tasks.filter((t) => t.status === s).length;
  $("#stats").innerHTML = [
    ["Tổng việc", tasks.length],
    ["Đang vướng", count("BLOCKED")],
    ["Chờ duyệt", count("SUBMITTED")],
    ["Hoàn thành", count("DONE")],
  ]
    .map(
      ([t, n]) => `<article><small>${t}</small><strong>${n}</strong></article>`,
    )
    .join("");
  const shown = tasks.filter((t) => !filter || filter === t.status);
  $("#tasks").innerHTML =
    shown
      .map(
        (t) =>
          `<article class="card task"><div><span class="badge">${labels[t.status]}</span> <small>${esc(t.code)}</small></div><h3>${esc(t.title)}</h3><div class="muted">${esc(t.assignee_name)}</div><progress value="${t.done}" max="${t.total}"></progress><strong>${t.done} / ${t.total} · ${Math.round((t.done / t.total) * 100)}%</strong><small class="${t.status !== "DONE" && Date.parse(t.deadline) < Date.now() ? "late" : ""}">Hạn: ${date(t.deadline)}</small>${t.reason ? `<p class="error">${esc(t.reason)}</p>` : ""}<button class="secondary" data-task="${t.id}">Chi tiết & báo cáo</button></article>`,
      )
      .join("") || "<section>Chưa có công việc ở trạng thái này.</section>";
  document
    .querySelectorAll("[data-task]")
    .forEach(
      (b) =>
        (b.onclick = () => detail(b.dataset.task).catch((e) => msg(e.message))),
    );
}
function renderEvents() {
  if ($("#events"))
    $("#events").innerHTML =
      events
        .slice(-30)
        .reverse()
        .map((e) => `<p>${esc(e.title)}<small>${date(e.created)}</small></p>`)
        .join("") || '<p class="muted">Chưa có thông báo.</p>';
}
async function detail(id) {
  const d = await api("/tasks/" + id),
    t = d.task;
  modal(
    `<h2>${esc(t.title)}</h2><p>${esc(t.description)}</p><p><span class="badge">${labels[t.status]}</span> ${t.done}/${t.total} · Hạn ${date(t.deadline)}</p>${me.role === "USER" && !["DONE", "SUBMITTED"].includes(t.status) ? `<form id="report"><label>Số lượng đã hoàn thành<input name="done" type="number" min="0" max="${t.total}" step="any" value="${t.done}" required></label><label>Trạng thái<select name="status"><option value="IN_PROGRESS">Đang làm</option><option value="BLOCKED">Đang vướng / chưa hoàn thành</option><option value="SUBMITTED">Gửi hoàn thành để duyệt</option></select></label><label>Ghi chú<textarea name="note" maxlength="2000"></textarea></label><label>Lý do chưa hoàn thành / đề nghị hỗ trợ<textarea name="reason" maxlength="2000"></textarea></label><label>Ảnh minh chứng (JPG/PNG, tối đa 3 ảnh, 2 MB/ảnh)<input type="file" id="photos" accept="image/jpeg,image/png" multiple></label><button>Gửi báo cáo</button><p class="hint">Chỉ báo gửi thành công khi máy chủ đã lưu. Nếu mất mạng, giữ màn hình này và gửi lại.</p></form>` : ""}${me.role === "ADMIN" && t.status === "SUBMITTED" ? '<form id="review"><label>Nhận xét<textarea name="note"></textarea></label><label>Quyết định<select name="decision"><option value="approve">Duyệt hoàn thành</option><option value="return">Yêu cầu làm lại</option></select></label><button>Xác nhận</button></form>' : ""}<h3>Lịch sử báo cáo</h3>${
      d.reports
        .map(
          (r) =>
            `<section><strong>${esc(r.name)} · ${r.done}/${t.total}</strong><small>${date(r.created)} · ${labels[r.status]}</small><p>${esc(r.note)}</p><p class="error">${esc(r.reason)}</p>${d.photos
              .filter((p) => p.report_id === r.id)
              .map(
                (p) =>
                  `<a href="/api/photos/${p.id}" target="_blank"><img class="photo" alt="Ảnh báo cáo" src="/api/photos/${p.id}"></a>`,
              )
              .join("")}</section>`,
        )
        .join("") || "<p>Chưa có báo cáo.</p>"
    }<h3>Nhật ký thao tác</h3>${d.audit.map((a) => `<p><strong>${esc(a.name)}</strong> · ${esc(a.action)}<small>${date(a.created)}</small><span>${esc(JSON.stringify(JSON.parse(a.data)))}</span></p>`).join("")}`,
  );
  bindForm("#report", async (b) => {
    const files = [...$("#photos").files];
    if (files.length > 3 || files.some((f) => f.size > 2 * 1024 * 1024))
      throw new Error("Tối đa 3 ảnh, mỗi ảnh 2 MB.");
    const photos = await Promise.all(
      files.map(async (f) => ({ mime: f.type, data: await base64(f) })),
    );
    await api("/tasks/" + id + "/report", "POST", {
      ...b,
      done: Number(b.done),
      version: t.version,
      photos,
    });
    dialog.close();
    msg("Báo cáo đã lưu trên máy chủ.");
    await dashboard();
  });
  bindForm("#review", async (b) => {
    await api("/tasks/" + id + "/review", "POST", { ...b, version: t.version });
    dialog.close();
    msg("Đã lưu kết quả duyệt.");
    await dashboard();
  });
}
function newTask() {
  modal(
    `<h2>Giao công việc</h2><form id="newtask"><label>Mã việc<input name="code" required maxlength="80"></label><label>Tên công việc<input name="title" required maxlength="240"></label><label>Người thực hiện<select name="assignee" required><option value="">Chọn nhân viên</option>${users
      .filter((u) => u.role === "USER" && u.active)
      .map(
        (u) =>
          `<option value="${u.id}">${esc(u.name)} (${esc(u.username)})</option>`,
      )
      .join(
        "",
      )}</select></label><div class="row"><label>Hạn hoàn thành<input type="datetime-local" name="deadline" required></label><label>Số lượng yêu cầu<input type="number" name="total" min="0.01" step="any" value="1" required></label></div><label>Mô tả / yêu cầu<textarea name="description"></textarea></label><button>Giao việc</button></form>`,
  );
  bindForm("#newtask", async (b) => {
    await api("/tasks", "POST", {
      ...b,
      total: Number(b.total),
      deadline: new Date(b.deadline).toISOString(),
    });
    dialog.close();
    msg("Đã giao việc.");
    await dashboard();
  });
}
function people() {
  modal(
    `<h2>Nhân viên</h2><div class="scroll"><table><thead><tr><th>Họ tên</th><th>Tài khoản</th><th>Trạng thái</th></tr></thead><tbody>${users.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${u.role === "USER" ? `<button class="secondary" data-user="${u.id}" data-active="${u.active}">${u.active ? "Khóa" : "Mở khóa"}</button>` : "Quản trị"}</td></tr>`).join("")}</tbody></table></div><h3>Thêm nhân viên</h3><form id="person"><label>Họ tên<input name="name" required maxlength="100"></label><label>Tài khoản<input name="username" required pattern="[a-zA-Z0-9_.-]{3,60}"></label><label>Mật khẩu ban đầu<input name="password" type="password" minlength="10" maxlength="128" required></label><button>Tạo tài khoản User</button></form>`,
  );
  bindForm("#person", async (b) => {
    await api("/users", "POST", b);
    await load();
    people();
    msg("Đã tạo nhân viên.");
  });
  document.querySelectorAll("[data-user]").forEach(
    (b) =>
      (b.onclick = async () => {
        try {
          await api("/users/" + b.dataset.user, "PATCH", {
            active: b.dataset.active === "0",
          });
          await load();
          people();
        } catch (e) {
          msg(e.message);
        }
      }),
  );
}
function passwordForm() {
  modal(
    '<h2>Đổi mật khẩu</h2><form id="pw"><label>Mật khẩu hiện tại<input name="current" type="password" required></label><label>Mật khẩu mới<input name="password" type="password" minlength="10" maxlength="128" required></label><button>Đổi và đăng nhập lại</button></form>',
  );
  bindForm("#pw", async (b) => {
    await api("/password", "POST", b);
    dialog.close();
    await login();
    msg("Đã đổi mật khẩu. Vui lòng đăng nhập lại.");
  });
}
const base64 = (f) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("Không đọc được file"));
    r.readAsDataURL(f);
  });
function download(blob, name) {
  const a = document.createElement("a"),
    url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
function excel() {
  modal(
    '<h2>Nhập công việc từ Excel</h2><p>Sheet đầu tiên, tối đa 500 dòng. Tài khoản nhân viên phải được tạo trước.</p><a class="button secondary" href="/api/template">Tải mẫu Excel</a><form id="upload"><label>Chọn file .xlsx<input id="xlsx" type="file" accept=".xlsx" required></label><button>Xem cột dữ liệu</button></form><div id="mapping"></div>',
  );
  bindForm("#upload", async () => {
    const f = $("#xlsx").files[0];
    if (f.size > 5 * 1024 * 1024) throw new Error("File tối đa 5 MB.");
    const data = await api("/import/preview", "POST", {
      file: await base64(f),
    });
    mapping(data);
  });
}
function mapping(data) {
  const fields = {
    code: "Mã việc",
    title: "Tên việc",
    username: "Tài khoản",
    deadline: "Hạn hoàn thành",
    total: "Số lượng",
    description: "Mô tả",
  };
  $("#mapping").innerHTML = `<h3>Ghép cột</h3><form id="map">${Object.entries(
    fields,
  )
    .map(
      ([k, v], i) =>
        `<label>${v}<select name="${k}">${data.headers.map((h, j) => `<option value="${j}" ${j === i ? "selected" : ""}>${j + 1}. ${esc(h)}</option>`).join("")}</select></label>`,
    )
    .join(
      "",
    )}<button>Kiểm tra & xem trước</button></form><div id="preview"></div>`;
  bindForm("#map", async (map) => {
    const result = data.rows
      .filter((r) => r.some((v) => String(v).trim()))
      .map((r) =>
        Object.fromEntries(
          Object.keys(fields).map((k) => [k, r[Number(map[k])] || ""]),
        ),
      );
    const seen = new Set(tasks.map((t) => t.code));
    const errors = [];
    result.forEach((t, i) => {
      t.code = t.code.trim();
      t.title = t.title.trim();
      t.username = t.username.trim().toLowerCase();
      t.total = Number(t.total);
      const d = new Date(t.deadline);
      if (
        !t.code ||
        !t.title ||
        !Number.isFinite(t.total) ||
        t.total <= 0 ||
        !Number.isFinite(d.getTime())
      )
        errors.push(`Dòng ${i + 2}: thiếu dữ liệu hoặc ngày/số lượng sai.`);
      else t.deadline = d.toISOString();
      if (
        !users.some(
          (u) => u.username === t.username && u.active && u.role === "USER",
        )
      )
        errors.push(`Dòng ${i + 2}: không có nhân viên ${t.username}.`);
      if (seen.has(t.code)) errors.push(`Dòng ${i + 2}: trùng mã ${t.code}.`);
      seen.add(t.code);
    });
    $("#preview").innerHTML =
      `<h3>${result.length} công việc</h3><p class="hint">Ngày giờ hiển thị theo thiết bị này. Dùng YYYY-MM-DD HH:mm khi nhập dạng chữ.</p><div class="error">${errors.map((e) => `<p>${esc(e)}</p>`).join("")}</div><div class="scroll"><table><tr>${Object.values(
        fields,
      )
        .map((v) => `<th>${v}</th>`)
        .join("")}</tr>${result
        .map(
          (t) =>
            `<tr>${Object.keys(fields)
              .map(
                (k) => `<td>${esc(k === "deadline" ? date(t[k]) : t[k])}</td>`,
              )
              .join("")}</tr>`,
        )
        .join(
          "",
        )}</table></div><button id="commit" ${errors.length || !result.length ? "disabled" : ""}>Xác nhận nhập ${result.length} việc</button>`;
    $("#commit").onclick = async (e) => {
      e.target.disabled = true;
      try {
        const r = await api("/import/commit", "POST", { tasks: result });
        dialog.close();
        msg(`Đã nhập ${r.count} việc.`);
        await dashboard();
      } catch (err) {
        msg(err.message);
        e.target.disabled = false;
      }
    };
  });
}
setInterval(async () => {
  if (!me || polling) return;
  polling = true;
  try {
    const rows = await api("/events?after=" + cursor);
    if (rows.length) {
      const initial = cursor === 0;
      cursor = rows.at(-1).id;
      events.push(...rows);
      renderEvents();
      if (!initial) msg(rows.at(-1).title);
    }
    tasks = await api("/tasks");
    if ($("#tasks")) renderTasks();
    if ($("#connection"))
      $("#connection").textContent =
        "Đã kết nối · Cập nhật " + new Date().toLocaleTimeString("vi-VN");
  } catch {
    if ($("#connection"))
      $("#connection").textContent =
        "Mất kết nối hoặc hết phiên. Báo cáo chưa gửi sẽ chưa được lưu trên máy chủ.";
  } finally {
    polling = false;
  }
}, 5000);
boot().catch((e) => msg(e.message));
