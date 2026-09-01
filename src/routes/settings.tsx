import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/cvp/page-header";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/input";
import { useRows } from "@/lib/cvp/hooks";
import { getDb, resetDatabase } from "@/lib/cvp/db";
import { useAppStore } from "@/lib/cvp/store";
import { applyCurrentUser, applyShift, wipeSample } from "@/lib/cvp/init";
import { persistSetting } from "@/lib/cvp/repo";
import { requestNotifyPermission } from "@/lib/cvp/reminders";
import { ROLE_LABEL, APP_VERSION } from "@/lib/cvp/types";
import { can } from "@/lib/cvp/permissions";

export const Route = createFileRoute("/settings")({ component: SettingsPage });

function SettingsPage() {
  const store = useAppStore();
  const people = useRows(() => getDb().employees.toArray());
  const shifts = useRows(() => getDb().shifts.orderBy("order").toArray());

  return (
    <div className="space-y-4">
      <PageHeader title="Cài đặt" subtitle={`CongViecPro ${APP_VERSION}`} />
      <section className="space-y-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="font-medium">Người đang thao tác</h2>
        <Field label="Tài khoản trên máy này">
          <NativeSelect
            value={store.currentUserId ?? ""}
            onChange={(e) => void applyCurrentUser(e.target.value || null)}
          >
            <option value="">Hệ thống</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {ROLE_LABEL[p.role]}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="text-xs text-muted">
          Quyền hiện tại: {ROLE_LABEL[store.role]}. ADMIN toàn quyền, LEADER quản lý ca, USER thực hiện, VIEWER chỉ xem.
        </p>
      </section>
      <section className="space-y-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="font-medium">Ca & OT</h2>
        <label className="flex min-h-12 items-center gap-3">
          <input
            type="checkbox"
            className="size-5 accent-primary"
            checked={store.autoShift}
            onChange={(e) => void applyShift(store.selectedShiftId, e.target.checked)}
          />
          Tự chọn ca theo giờ máy
        </label>
        <Field label="Làm tròn OT (phút)">
          <NativeSelect
            value={String(store.otRoundMinutes)}
            onChange={(e) => {
              const n = Number(e.target.value);
              store.setOtRound(n);
              void persistSetting("otRoundMinutes", String(n));
            }}
          >
            {[15, 30, 60].map((n) => (
              <option key={n} value={n}>
                {n} phút
              </option>
            ))}
          </NativeSelect>
        </Field>
        <p className="text-xs text-muted">
          Ca 4 22:00–06:00 qua ngày. OT 22:00→01:00 = 3 giờ.
        </p>
        <ul className="text-sm text-muted">
          {shifts.map((s) => (
            <li key={s.id}>
              {s.name}: {s.startTime}–{s.endTime}
              {s.crossesMidnight ? " (qua ngày)" : ""}
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="font-medium">Nhắc việc</h2>
        <Button
          variant="secondary"
          className="w-full"
          onClick={async () => {
            const ok = await requestNotifyPermission();
            toast[ok ? "success" : "error"](ok ? "Đã bật thông báo" : "Chưa cấp quyền thông báo");
          }}
        >
          Bật thông báo trình duyệt
        </Button>
        <p className="text-xs text-muted">Nhắc việc đến hạn, DATA thiếu, lot chưa chốt — chạy cả khi đang ở màn khác.</p>
      </section>
      <section className="space-y-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="font-medium">Dữ liệu</h2>
        {store.sampleData ? (
          <Button
            variant="secondary"
            className="w-full"
            onClick={async () => {
              if (!confirm("Xóa toàn bộ dữ liệu mẫu? Dữ liệu bạn tự nhập sẽ giữ lại nếu không gắn cờ mẫu.")) return;
              await wipeSample();
              toast.success("Đã xóa dữ liệu mẫu");
            }}
          >
            Xóa dữ liệu mẫu
          </Button>
        ) : (
          <p className="text-sm text-muted">Không còn dữ liệu mẫu.</p>
        )}
        {can(store.role, "settings") ? (
          <Button
            variant="danger"
            className="w-full"
            onClick={async () => {
              if (!confirm("⚠️ XÓA TOÀN BỘ DỮ LIỆU\n\nTất cả công việc, ảnh, DATA, Lot và lịch sử trên máy sẽ bị xóa. Hãy Backup trước nếu còn cần dữ liệu.")) return;
              const token = window.prompt("Nhập RESET để xác nhận xóa toàn bộ dữ liệu:");
              if (token !== "RESET") {
                toast.error("Đã hủy Reset");
                return;
              }
              await resetDatabase();
              window.location.reload();
            }}
          >
            Reset ứng dụng
          </Button>
        ) : null}
      </section>
      <section className="space-y-3 rounded-xl bg-surface p-4 shadow-[var(--shadow-border)]">
        <h2 className="font-medium">File APK Android</h2>
        <p className="text-sm text-muted">
          Đẩy project lên GitHub, vào tab Actions, chạy workflow <span className="text-fg">Build APK</span>,
          rồi tải artifact <span className="font-mono text-fg">CongViecPro.apk</span>. Cài trên điện thoại
          (cho phép cài từ nguồn không xác định). App chạy offline, dữ liệu lưu trên máy.
        </p>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted">
          <li>GitHub → tab Actions → Build APK → Run workflow</li>
          <li>Mở job xong → Artifacts → CongViecPro-apk</li>
          <li>Giải nén zip, cài file .apk trên Android</li>
        </ol>
      </section>
    </div>
  );
}
