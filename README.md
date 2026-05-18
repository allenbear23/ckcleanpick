# 🧹 隨機掃地工作 2.0 (Vercel Standalone & Excel Import)

這是一個特別為班級掃除指派設計的**獨立站台系統**。具備高質感的玻璃磨砂現代設計與令人會心一笑的傳統臺灣**華國美學**雙主題切換！
此外，本版本整合了 **Excel 班級名單一鍵拖放匯入**，並以 **Vercel Serverless Function** 技術封裝了 LINE Messaging API，確保您的 LINE Bot 金鑰 100% 隱私安全，絕不洩漏給前端瀏覽器！

---

## 🌟 特色功能

1. **🎨 雙主題美學切換**：預設為質感深色玻璃磨砂風格；一鍵切換成趣味橫生、極致親切的「青年建功立業 華國美學勞動派遣系統」復古網頁風格！
2. **📊 Excel 一鍵名單匯入**：支持直接拖放 Excel (`.xlsx`, `.xls`) 檔至網頁，系統自動解析第一欄的學生姓名填入，免去手動打字煩惱。
3. **🛡️ 隱私安全後端**：LINE 金鑰（Access Token）與群組 ID 完全儲存在 Vercel 後端環境變數中，防止被惡意偷看，同時徹底解決前端跨網域 CORS 問題。
4. **💬 雙重 LINE 串接方式**：
   * **一鍵分享 (免設定)**：點擊直接跳轉 LINE App，自由選取任意群組傳送！
   * **安全推送 (自動背景)**：串接 Vercel 後端 API，點擊後免跳轉，在背景秒速推送至設定的 LINE 群組中！

---

## 🚀 部署到 Vercel 步驟說明

### 方式 1：GitHub 點擊部署 (最推薦)
1. 將此 `clean-v2-standalone` 目錄上傳到您的個人 GitHub 儲存庫 (Repository)。
2. 進入 [Vercel 官網](https://vercel.com/) 並登入。
3. 點選 **Add New... ➔ Project**，導入您剛剛上傳的 GitHub 儲存庫。
4. 在 **Environment Variables** 欄位中，加入以下兩個金鑰：
   * 🔑 **`LINE_CHANNEL_ACCESS_TOKEN`**：您的 LINE Developers Bot 頻道憑證。
   * 💬 **`LINE_GROUP_ID`**：要發送訊息的 LINE 目標群組 ID。
5. 點擊 **Deploy**！僅需 10 秒即部署完成，獲得專屬的免費網址！

### 方式 2：使用 Vercel CLI 本地部署
如果您本地安裝有 `vercel` 工具，可以直接在該目錄下運行：
```bash
# 登入 Vercel (第一次使用需執行)
vercel login

# 開始部署專案
vercel

# 設定環境變數
vercel env add LINE_CHANNEL_ACCESS_TOKEN
vercel env add LINE_GROUP_ID

# 重新部署以套用環境變數
vercel --prod
```

---

## 🗃️ 專案檔案結構說明

* 📁 `api/push.js`：Node.js Serverless 後端函數，負責接收抽籤結果並以隱私模式調用 LINE API 發送訊息。同時支持 `GET` 方法以安全探測金鑰配置狀態。
* 📄 `index.html`：網頁前端主介面，整合了 SheetJS 解析器、動態抽籤邏輯、Canvas Confetti 特效、以及雙主題 CSS 引擎。
* 📄 `vercel.json`：Vercel 部署設定檔，開啟了 cleanUrls（消除網頁副檔名字尾）。
* 📄 `package.json`：標準 Node.js 專案描述檔。

---

## ⚙️ 名單快取機制
本站具備 LocalStorage 本地儲存功能。即使關閉網頁或重新整理，您儲存的名單、工作清單以及覆蓋的群組 ID 都會完整保留在當前的瀏覽器中，無須每次開啟都重新設定！
