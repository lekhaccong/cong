# CongViecPro LAN — bản thử nghiệm 0.1.0

Bản thử nghiệm cho máy Windows 10 tại nhà và điện thoại cùng Wi-Fi.
Dùng dữ liệu giả. Chưa triển khai trên hạ tầng hoặc dữ liệu công ty.

## Chạy trên Windows

1. Giải nén toàn bộ gói vào một thư mục, ví dụ `C:\CongViecPro-LAN`.
2. Cài **Node.js 24 LTS** từ https://nodejs.org/en/download (Windows x64 nếu máy dùng Windows 64 bit).
3. Mở thư mục `lan-server`, bấm đúp `KHOI-DONG.bat`. Không chạy trực tiếp từ trong ZIP.
4. Giữ cửa sổ máy chủ đang mở. Trình duyệt sẽ mở `http://localhost:8080`.
5. Lần đầu, tự đặt tên đăng nhập và mật khẩu quản trị (ít nhất 10 ký tự). Không có mật khẩu mặc định.
6. Nếu Windows hỏi quyền mạng cho Node.js, chỉ cho phép mạng Private ở nhà. Không mở cổng ra Internet.
7. Nếu trang mở trước khi máy chủ sẵn sàng, nhấn tải lại. Nếu cổng 8080 đã dùng, tắt ứng dụng chiếm cổng hoặc đặt PORT trong cửa sổ CMD trước khi chạy.

Gói có sẵn thư viện. Nếu thư mục node_modules bị thiếu, file khởi động sẽ tải qua npm; chỉ bước cài thư viện cần Internet.

## Điện thoại

- Kết nối cùng Wi-Fi với máy tính (không dùng Wi-Fi khách có cách ly thiết bị).
- Mở Chrome, nhập địa chỉ dòng `Dien thoai cung Wi-Fi` trong cửa sổ máy chủ, ví dụ `http://192.168.1.20:8080`.
- Nếu máy chủ không in địa chỉ do môi trường hệ thống, dùng `ipconfig` trên Windows, lấy IPv4 của Wi-Fi đang dùng.
- Đăng nhập tài khoản User do Admin tạo. Có thể thêm trang vào màn hình chính.
- `localhost` trên điện thoại là chính điện thoại, không phải máy tính.
- Nếu không mở được: kiểm tra máy tính còn bật, cùng Wi-Fi và Windows Firewall cho Node.js trên Private network. Không tắt toàn bộ firewall.

## Thử một vòng hoàn chỉnh

1. Admin > Nhân viên: tạo `nhanvien01`, đặt mật khẩu ban đầu riêng. Giao mật khẩu trực tiếp cho người thử.
2. Admin > Giao việc: mã `VIEC-001`, tên `Kiểm tra hàng mẫu`, chọn nhân viên, số lượng 100, đặt hạn.
3. User đăng nhập trên điện thoại > Chi tiết & báo cáo: nhập 60, Đang vướng, lý do `Thiếu 40 thùng`, gửi báo cáo.
4. Admin xem tiến độ 60%, lý do và thông báo. Thông báo được tải mỗi 5 giây khi trang đang mở.
5. User báo 100 và chọn Gửi hoàn thành để duyệt; có thể đính kèm tối đa 3 ảnh JPG/PNG, mỗi ảnh 2 MB.
6. Admin mở chi tiết > Duyệt hoàn thành hoặc Yêu cầu làm lại có lý do.
7. Thử tài khoản User khác: không được thấy công việc của người đầu tiên.

## Excel

Admin > Nhập Excel > Tải mẫu Excel. Chỉ hỗ trợ `.xlsx`, sheet đầu tiên, tối đa 500 dòng/50 cột và file 5 MB.

Cột mẫu: Mã việc / Tên việc / Tài khoản / Hạn hoàn thành / Số lượng / Mô tả.
Tạo tài khoản nhân viên trước. Mã việc phải duy nhất. Hạn dạng `YYYY-MM-DD HH:mm` theo giờ máy nhập hoặc ô Excel ngày giờ.

Chọn file > ghép cột > Kiểm tra & xem trước > Xác nhận nhập.
Nếu bất kỳ dòng nào không hợp lệ hoặc trùng mã, không nhập dòng nào; sửa file và thử lại.
Đây là nhập mới công việc, không tự ghi đè công việc đã có.

## Dữ liệu và sao lưu

- Database: `lan-server\data\congviec.sqlite`; ảnh nằm trong cùng database.
- Không xóa thư mục data, không lưu thư mục chạy trong ổ tạm.
- Admin > Sao lưu: tải file SQLite đầy đủ. Máy chủ cũng giữ bản trong `data\backups`.
- Khi máy chủ chạy liên tục, tự sao lưu mỗi 6 giờ; giữ 7 bản mới nhất. Chép bản sao sang ổ khác để chống hỏng ổ máy chủ.
- File sao lưu có dữ liệu và thông tin xác thực đã băm; bảo vệ file như dữ liệu nhạy cảm.
- Khôi phục: dừng máy chủ bằng Ctrl+C, bấm `KHOI-PHUC.bat`, nhập đường dẫn file và xác nhận KHOIPHUC.
- Khôi phục thay dữ liệu hiện tại; chương trình giữ bản `.before-restore-*` bên cạnh database. Sau khôi phục mọi tài khoản phải đăng nhập lại.

## Đưa nút kết nối vào APK hiện có

Thư mục `app-update` trong gói có 3 file dành cho repo `lekhaccong/cong`, dựa trên commit `655d625d41dcbaa56c878545fd94b55d2699ac2f`.
Chép giữ đúng đường dẫn `src/...`, build APK rồi cài đè bằng cùng khóa ký đang dùng.
Trong app: Module > Hệ thống nội bộ > nhập URL máy chủ > Mở hệ thống để đăng nhập.
Nút này mở hệ thống bằng trình duyệt; không phải đồng bộ dữ liệu cá nhân cũ lên máy chủ.
Không cần cập nhật APK để thử: điện thoại có thể mở URL máy chủ trực tiếp ngay.

## Phạm vi và giới hạn

- Có Admin/User, tạo/khóa User, đổi mật khẩu, phân quyền phía máy chủ, giao việc, báo cáo, ảnh, duyệt/trả lại, lịch sử, Excel và backup/restore.
- User bị khóa mất quyền cả các phiên đã đăng nhập. Phiên hết hạn sau 12 giờ.
- Bản đầu chưa có nhóm/Leader, sửa hoặc xóa việc, nhắc hạn Android khi đóng app, chế độ lưu hàng đợi offline, tự cập nhật APK hay chuyển dữ liệu app cá nhân.
- Khi mất mạng, báo cáo chưa gửi không được tự lưu bền vững; giữ trang đang nhập và gửi lại khi kết nối. Không đóng trang trước khi báo thành công.
- HTTP không mã hóa mật khẩu/dữ liệu trên đường truyền. Chỉ dùng dữ liệu giả và mật khẩu thử trên mạng nhà tin cậy. Trước khi đưa vào công ty cần IT cấp phép, HTTPS, chính sách tài khoản/sao lưu và kiểm thử bảo mật/khôi phục.
- Đây là mã chạy đa nền tảng đã kiểm thử trong Linux; chưa xác nhận trực tiếp trên Windows 10 hoặc điện thoại thật.
