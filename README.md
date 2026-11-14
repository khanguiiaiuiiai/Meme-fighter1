# MEME FIGHTER Online – deploy lên Render

## Cách deploy
1. Tạo repo GitHub mới, upload toàn bộ thư mục này (server.js, package.json, render.yaml, public/).
2. Vào https://dashboard.render.com → New + → Web Service → chọn repo.
3. Cài đặt: Runtime = Node, Build Command = `npm install`, Start Command = `npm start`, Plan = Free.
   (Hoặc New + → Blueprint, Render tự đọc render.yaml.)
4. Bấm Deploy, xong mở link `https://<tên>.onrender.com`, gửi bạn bè để đấu Rank.

## Lưu ý
- Gói Free ngủ sau ~15 phút không dùng (lần mở đầu chậm ~30s) và xoá file dữ liệu khi redeploy,
  nên bảng xếp hạng sẽ reset. Muốn giữ: gắn Disk trên Render rồi đặt biến môi trường DATA_DIR=/đường/dẫn/disk.
- Cần 2 người cùng mở link mới ghép được Rank.
