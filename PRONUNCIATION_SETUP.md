# Cấu hình chấm phát âm chính xác

Chill English Quiz có thể chạy ở hai chế độ:

- **Azure Speech:** trả điểm phát âm theo âm vị. Cần một Speech resource và hai biến môi trường riêng tư trên Vercel.
- **Dự phòng trên trình duyệt:** dùng nhận dạng giọng nói và so khớp từ. Điểm chỉ là ước lượng, không đánh giá chính xác từng âm.

## Thêm khóa vào Vercel

1. Trong Azure Portal, tạo một **Speech** resource. Mở trang **Keys and Endpoint** và lấy một key cùng region của resource.
2. Trong Vercel, mở project **chill-english-quiz** → **Settings** → **Environment Variables**.
3. Thêm:
   - `AZURE_SPEECH_KEY` = key của Speech resource
   - `AZURE_SPEECH_REGION` = region, ví dụ `eastus`
4. Chọn môi trường **Production** (và **Preview** nếu muốn thử bản xem trước), lưu lại rồi redeploy project.
5. Đăng nhập Chill English Quiz, mở **Cài đặt** và dùng nút **Kiểm tra kết nối phát âm**.

**Không đưa key vào GitHub, mã giao diện hoặc tin nhắn.** Endpoint kiểm tra đăng nhập Supabase trước khi cấp token Azure ngắn hạn cho trình duyệt. Nếu chưa cấu hình Azure, app tự chuyển sang chế độ dự phòng và sẽ ghi rõ điểm đó chỉ là ước lượng.

## Ghi chú điểm số

Mức đạt mặc định là **75/100**. Điểm tổng trong chế độ Azure tính theo **85% độ chính xác + 15% độ đầy đủ**. Điểm âm vị là phản hồi hỗ trợ luyện tập; phần tô màu từng chữ cái chỉ là ánh xạ gần đúng từ các âm vị.
