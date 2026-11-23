# Cấu hình chấm phát âm Hugging Face

Ứng dụng gửi bản thu âm WAV mono 16 kHz tới API trên Vercel. Khóa Hugging Face chỉ được đọc ở phía máy chủ; trình duyệt không nhận khóa này. Khi API hoặc khóa chưa sẵn sàng, ứng dụng dùng nhận diện giọng nói tích hợp của trình duyệt và ghi rõ điểm đó là ước lượng.

## 1. Tạo Hugging Face token

1. Mở [Hugging Face Access Tokens](https://huggingface.co/settings/tokens) và tạo token có quyền **Inference Providers**.
2. Sao chép token để nhập vào phần Environment Variables của Vercel. Không thêm token vào mã nguồn hoặc gửi trong ứng dụng.

## 2. Thêm biến trên Vercel

Trong dự án **chill-english-quiz**, mở **Settings → Environment Variables**, thêm:

- Name: **HF_TOKEN**
- Value: token vừa tạo
- Environments: Production và Preview

Lưu biến rồi triển khai lại dự án. Có thể vào **Cài đặt → Chấm phát âm → Kiểm tra kết nối** để xác nhận máy chủ đã sẵn sàng.

## 3. Luồng chấm điểm

- Khi thẻ có IPA, API dùng **facebook/wav2vec2-lv-60-espeak-cv-ft** để nhận diện âm vị và so sánh với IPA tham chiếu.
- Khi thẻ chưa có IPA hoặc mô hình âm vị không khả dụng, API dùng **openai/whisper-large-v3-turbo** để nhận diện từ và trả về điểm ước lượng có nhãn riêng.
- Nếu Hugging Face chưa cấu hình hoặc không truy cập được, giao diện thử nhận diện bằng trình duyệt.

Các endpoint **/api/assess-pronunciation** và **/api/speech-token** yêu cầu phiên Supabase hợp lệ. Không lưu **HF_TOKEN** trong HTML, JavaScript phía trình duyệt hay kho Git.
