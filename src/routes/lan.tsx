import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/cvp/page-header";
import { Button } from "@/components/ui/button";
import { Input, Field } from "@/components/ui/input";

export const Route = createFileRoute("/lan")({ component: LanPage });
function LanPage() {
  const [address, setAddress] = useState(() =>
    typeof window === "undefined"
      ? ""
      : (localStorage.getItem("cvp-lan-url") ?? ""),
  );
  const [error, setError] = useState("");
  return (
    <div className="space-y-4">
      <PageHeader
        title="Hệ thống nội bộ"
        subtitle="Giao việc và báo cáo trên máy chủ Windows"
      />
      <form
        className="space-y-4 rounded-xl bg-surface p-4"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const url = new URL(address);
            const host = url.hostname;
            const octets = host.split(".").map(Number);
            const ipv4 =
              /^\d+\.\d+\.\d+\.\d+$/.test(host) &&
              octets.every((n) => n >= 0 && n <= 255);
            const privateHost =
              host === "localhost" ||
              (ipv4 &&
                (octets[0] === 127 ||
                  octets[0] === 10 ||
                  (octets[0] === 192 && octets[1] === 168) ||
                  (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)));
            if (
              !privateHost ||
              !["http:", "https:"].includes(url.protocol) ||
              url.username ||
              url.password
            )
              throw new Error(
                "Nhập địa chỉ IP nội bộ, ví dụ http://192.168.1.20:8080",
              );
            localStorage.setItem("cvp-lan-url", url.origin);
            window.open(url.origin, "_blank", "noopener,noreferrer");
            setError("");
          } catch (e) {
            setError(e instanceof Error ? e.message : "Địa chỉ không hợp lệ");
          }
        }}
      >
        <p>
          Khởi động máy chủ ở nhà và kết nối điện thoại cùng Wi-Fi. Địa chỉ dành
          cho điện thoại được hiển thị trong cửa sổ máy chủ.
        </p>
        <Field label="Địa chỉ máy chủ">
          <Input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="http://192.168.1.20:8080"
            required
          />
        </Field>
        {error ? (
          <p role="alert" className="text-sm text-red-500">
            {error}
          </p>
        ) : null}
        <Button type="submit">Mở hệ thống để đăng nhập</Button>
        <p className="text-sm text-muted">
          Mở giao diện hệ thống trong trình duyệt. Bản thử nghiệm dùng dữ liệu
          giả; tài khoản và dữ liệu cá nhân trong app không tự chuyển sang máy
          chủ.
        </p>
      </form>
    </div>
  );
}
