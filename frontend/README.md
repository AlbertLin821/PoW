# 文件元件來源

於2026-11-18取自 Extend UI 官方 style-aware registry 的 `docx-viewer`、`docx-editor` 及其相依元件：

- https://ui.extend.ai/ui/r/styles/new-york/docx-viewer.json
- https://ui.extend.ai/ui/r/styles/new-york/docx-editor.json
- 上游原始碼：https://github.com/extend-hq/ui ，此次檢視版本 `70fe70c6f1e1eee53954c6923f3d9f583557a57e`。
- Extend UI 授權：MIT，原文保留於 `EXTEND-LICENSE.md`。
- 文件引擎：`@extend-ai/react-docx` 0.15.0，確切相依版本鎖定於根目錄 `package-lock.json`。引擎及其內含第三方授權隨建置複製至 `static/extend/*-license.txt`；JavaScript 授權保留於相鄰 `*.LEGAL.txt`。
- UI primitives 來自 shadcn 官方 registry，搭配 Radix；圖示使用 Lucide 的功能圖示。完整套件授權複製至 `static/extend/licenses/`，bundle 亦保留法律聲明。

本機調整：修正 registry 相對匯入路徑、加入 Lucide IconPlaceholder 適配器、在縮放完成後重算 viewer 當前頁碼，以及 editor 的 `onController` 回呼供主介面下載目前編輯內容。元件原有功能介面保留，未宣稱所有工具列功能都已逐項驗證。

`preview.tsx` 負責隔離 iframe 與父頁的檔案訊息、初始化 WASM、取得編輯後 DOCX。使用引擎支援的主執行緒匯入路徑，避免不具 same-origin 權限的 iframe 建立模組 worker 失敗。大型文件載入時可能短暫阻塞該 frame。

一般使用者不必建置；修改來源後在專案根目錄執行 `npm ci` 及 `npm run build:viewer`，並提交新的 `static/extend/`。建置輸出全部由本機提供，不依賴 CDN。

後端轉換採局部 OOXML 修改並驗證保留內容。右側編輯器是另一條重新匯出的路徑，其輸出不附後端原文保留報告；兩種下載刻意分開。
