# 絕對機密 Top Secret

藏好你的機密，跟朋友線上輪流猜，看誰先破解對方。有三種玩法：

- **飛機版**：各自在方格裡藏飛機，輪流猜格子開火，先找出對方所有機頭的人獲勝
- **海戰棋**：各自擺好艦隊，先擊沉對方整支艦隊的人獲勝
- **幾A幾B**：各自設一組數字密碼，輪流猜，先猜中對方密碼的人獲勝

開房的人選玩法與細項（飛機形狀或艦隊、格子數量；幾A幾B 是位數與數字可否重複），也可以先跟電腦練習。

- 前端：React + Vite
- 裁判後端：Node.js（上線時是 Vercel Functions）
- 登入、即時同步與資料庫：Firebase（Authentication + Firestore）
- 上線：前後端一起部署到 **Vercel**，步驟見 **[DEPLOY.md](DEPLOY.md)**
- 本機測試：一個指令就能跑，不需要任何雲端帳號

---

## 快速開始（本機測試）

需要 **Node.js 22**（跟 Vercel 上用的版本一樣）。

```bash
npm install
npm run dev
```

看到這兩行就代表成功：

```
[api]   ✈  絕對機密 API 已啟動：http://localhost:8787/api  （模式：local）
[web]   ➜  Local:   http://localhost:5173/
```

Windows 的 PowerShell 如果出現「已停用指令碼執行」，把指令裡的 `npm` 換成 `npm.cmd` 即可（例如 `npm.cmd install`、`npm.cmd run dev`）。

### 電腦不能安裝 Node.js 時（例如公司電腦）

用可攜版 Node.js，放在自己的資料夾裡，不需要系統管理員權限。在 PowerShell 貼上：

```powershell
# 1. 解壓縮專案：抓「下載」裡最新的 plane-hunt zip，解到 Downloads\plane-hunt
$zip = Get-ChildItem "$HOME\Downloads\plane-hunt*.zip" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
Expand-Archive $zip.FullName -DestinationPath "$HOME\Downloads" -Force

# 2. 下載可攜版 Node.js 22（只要做一次）
[Net.ServicePointManager]::SecurityProtocol = 'Tls12'
$ProgressPreference = 'SilentlyContinue'
$base = 'https://nodejs.org/dist/latest-v22.x'
$sums = (Invoke-WebRequest "$base/SHASUMS256.txt" -UseBasicParsing).Content
if ($sums -is [byte[]]) { $sums = [Text.Encoding]::ASCII.GetString($sums) }
$name = ((($sums -split "`n") | Where-Object { $_ -match 'win-x64\.zip' }) -replace '^\S+\s+', '').Trim()
Invoke-WebRequest "$base/$name" -OutFile "$env:TEMP\node.zip" -UseBasicParsing
Expand-Archive "$env:TEMP\node.zip" -DestinationPath "$HOME\node-portable" -Force

# 3. 啟用這份 Node（每開一個新的 PowerShell 視窗都要先執行這行）
$env:Path = (Get-ChildItem "$HOME\node-portable" -Directory | Select-Object -First 1).FullName + ";$env:Path"

# 4. 安裝套件並啟動
cd $HOME\Downloads\plane-hunt
npm.cmd install
npm.cmd run dev
```

之後每次要玩，只要執行第 3 步那一行，再 `cd` 到專案資料夾、`npm.cmd run dev`。不用時刪掉 `node-portable` 資料夾即可。

### 跟電腦練習（一個人就能測）

輸入暱稱 → 開新房間 → 選玩法，在設定頁「開房間」旁邊選難度（簡單、普通、困難），按「跟電腦練習」就會直接開打。

- 練習模式的對局完全在瀏覽器裡執行，不經過伺服器（只有打完時會把結果送去存進對戰紀錄）
- 電腦會自己擺飛機，輪到它時會停頓一下再開火
- 重新整理頁面可以接著打（進度存在這個分頁），「再來一局」電腦一定會接受
- 三種玩法都能跟電腦練習
- 難度差別：簡單大多亂打；普通會追擊打中的格子，但常常分心；困難每次都打最可能的格子。模擬結果：飛機版（經典 10×10、3 架）困難平均約 15 發找齊；海戰棋（經典艦隊 10×10）簡單約 81 發、普通約 56 發、困難約 38 發全滅；幾A幾B（4 位不重複）簡單約 9 次、普通約 6 次、困難約 5.3 次猜中

### 本機雙人測試

每個瀏覽器分頁都是一位獨立的玩家，所以一台電腦就能測。

**方法一：同一台電腦開兩個分頁**
1. 打開 http://localhost:5173 ，輸入暱稱 → 開新房間 → 選玩法 → 設定好後按「開房間」
2. 按「複製邀請連結」
3. 按 Ctrl+T 開新分頁，貼上連結，輸入另一個暱稱加入
4. 兩個分頁切來切去，各自擺飛機、輪流開火

注意不要用瀏覽器的「複製分頁」，那樣會連身分一起複製，兩個分頁會變成同一位玩家。改用一般視窗加無痕視窗，或 Chrome 加 Edge 也可以，比較不會搞混。

**方法二：電腦 + 手機（同一個 Wi-Fi）**
1. 在電腦開房間，等待畫面會多一個「複製手機用連結」（網址是電腦的區網 IP，例如 `http://192.168.1.23:5173/#/r/房號`）
2. 把這個連結傳到手機打開，輸入暱稱加入
3. 或者手機直接打開終端機上 `Network:` 那行的網址，在首頁輸入房號加入

`Network:` 可能會列出好幾個位址，其中 `192.168.56.x`（VirtualBox）和 VMware 的位址是虛擬網卡，手機連不到，請忽略。

第一次啟動時，Windows 防火牆會詢問是否允許 Node.js，請勾選「私人網路」並允許，否則手機連不進來。

> 本機模式的房間存在記憶體裡。修改後端程式碼時伺服器會自動重啟，房間就會消失，重新開一間即可。

### 模式二：用 Firebase 模擬器測真正的上線流程（選用）

上線前建議跑一次，確認 Firestore 讀寫、安全規則、匿名登入都正常。需要另外安裝 **Java 21 以上**（Firebase 模擬器需要）。

```bash
npm run dev:firebase
```

這會同時啟動：Firebase 模擬器（Auth + Firestore）、連到模擬器的後端、Firebase 模式的前端。專案 ID 用 `demo-planehunt`，`demo-` 開頭代表純本機，不用真的建立 Firebase 專案。

- 遊戲：http://localhost:5173
- 模擬器後台（可以直接看到 Firestore 裡的資料）：http://localhost:4000

第一次執行會下載 Firebase CLI 與模擬器，需要一點時間。

---

## 架構

```
 玩家瀏覽器 ── https://<專案>.vercel.app（網頁和 API 同一個網域）
   │
   ├─ 動作：開房 / 加入 / 擺飛機 / 開火 ──POST /api/…──▶ Vercel Function（裁判，香港機房）
   │                                                     │ 驗證身分、檢查規則、判定命中
   │                                                     ▼
   └─ 即時畫面 ◀──onSnapshot 監聽── Firestore（台灣）◀── 用 Admin SDK 寫入
        games/{房號}               公開狀態（雙方都看得到）
        games/{房號}/private/{uid} 自己的飛機位置（只有本人讀得到）
        users/{uid}/history/{局}   對戰紀錄（只透過後端讀寫）
        players/{uid}              排行榜戰績與獎牌（只透過後端讀寫）
```

**為什麼需要後端？** 這類遊戲最重要的是「對手看不到你的飛機」。如果只用 Firestore、讓前端自己寫資料，對手打開瀏覽器開發者工具就能看到你的飛機位置，也可以竄改命中結果。所以：

- 前端對 Firestore **只有讀取權限**，而且只能讀公開狀態和「自己」的飛機（見 `firestore.rules`）
- 所有寫入都經過後端（Vercel Function），由它驗證是不是輪到你、格子打過沒有、命中的是機頭還是機身
- 遊戲結束後，後端才把雙方飛機位置公開出來

**為什麼即時同步用 Firestore 而不是 WebSocket？** 回合制遊戲一回合只有一次更新，很適合 Firestore 的即時監聽：不用維持長連線，也不用一直開著伺服器。重新整理、手機切 App 都不會斷局，因為狀態都存在 Firestore。後端只在有人下棋時才被呼叫，很適合 Vercel Functions 這種用多少算多少、沒人用就休息的服務。

本機模式用同一套規則與後端程式，只是把 Firestore 換成記憶體、把即時監聽換成 SSE（Server-Sent Events），方便不設定任何雲端服務就能測。

### 目錄結構

```
plane-hunt/
├─ shared/                 前後端共用的遊戲規則（純函式、無相依套件）
│  ├─ src/shapes.ts        預設飛機形狀、自己畫的形狀驗證、海戰棋艦隊
│  ├─ src/plane.ts         旋轉、擺放驗證（含完全分開）、命中判定、擺放搜尋
│  ├─ src/code.ts          幾A幾B 的計分與密碼驗證
│  ├─ src/bot.ts           電腦對手的策略（三種玩法，三種難度）
│  ├─ src/engine.ts        開房、加入、擺放、開火、勝負、再來一局、離開
│  └─ test/                規則單元測試
├─ server/                 裁判後端（資料夾不能叫 api，那是 Vercel 保留給自動偵測函式的名字）
│  ├─ src/core/            動作處理與 HTTP 層（與框架無關）
│  ├─ src/store/           資料存取：memory.ts（本機）／firestore.ts（上線）
│  ├─ src/auth/            身分驗證：本機 token／Firebase ID token
│  ├─ src/dev-server.ts    本機伺服器（HTTP + SSE）
│  ├─ src/vercel.ts        Vercel Function 入口
│  └─ test/                API 整合測試（兩位玩家打完整一局）
├─ web/                    React 前端
│  ├─ src/net/             連線層：localBackend（SSE）／firebaseBackend（Firestore）／practiceBackend（跟電腦練習）
│  ├─ src/pages/           首頁、房間、擺放、對戰
│  ├─ src/pages/Lobby      大廳：暱稱 → 開新房間或加入 → 選玩法 → 設定
│  ├─ src/pages/CreateRoom 各玩法的設定細項
│  ├─ src/pages/CodeGame   幾A幾B 的設密碼與猜數字畫面
│  └─ src/components/      方格紙棋盤（SVG）、飛機、開火標記、畫飛機編輯器
├─ scripts/build-vercel.mjs  產生 Vercel 部署檔（.vercel/output）
├─ vercel.json             Vercel 專案設定（安裝與建置指令）
├─ DEPLOY.md               一步一步部署上線
├─ e2e/play.mjs            瀏覽器端對端測試（選用）
├─ firestore.rules         Firestore 安全規則（部署時貼到 Firebase 主控台）
└─ firebase.json           模擬器設定
```

---

## 指令

| 指令 | 用途 |
| --- | --- |
| `npm run dev` | 本機模式（記憶體 + SSE） |
| `npm run dev:firebase` | Firebase 模擬器模式（需要 Java 21） |
| `npm test` | 規則單元測試 + API 整合測試 |
| `npm run typecheck` | 三個套件的 TypeScript 型別檢查 |
| `npm run build` | 建置前端（`web/dist`，本機模式） |
| `npm run vercel-build` | 產生 Vercel 部署檔（`.vercel/output`）；Vercel 部署時會自動執行，需要的環境變數見 DEPLOY.md |
| `npm run e2e` | 開兩個瀏覽器實際打一局並截圖到 `e2e/screens/`（要先 `npm run dev`，並安裝 `npm i -D playwright && npx playwright install chromium`） |

---

## 遊戲規則與可以調整的地方

開房的人先選**玩法**，整個房間共用同一套設定（雙方都知道對方有哪些棋子，才能推理）。

### 飛機版

- **飛機形狀**：迷你機（5 格）、小飛機（8 格）、經典（10 格）、客機（13 格），或在 7×7 畫布上自己畫。自己畫的飛機要 3 到 20 格、每一格上下左右連在一起，並指定一格當機頭
- **飛機數量**：1 到 5 架。畫面會自動算出「這個棋盤最多放得下幾架」，放不下的選項會停用
- 開火結果：打中機頭、打中機身、沒打中。先找齊對方所有機頭的人獲勝，機身只是線索

### 海戰棋

- **艦隊**：經典艦隊（5、4、3、3、2 格，美式桌遊的配置）、大艦隊（4、3、3、2、2、2、1、1、1、1 格，俄式「海戰」的配置）、小艦隊（3、2、2 格），或自訂每種長度（1 到 6 格）各幾艘，最多 12 艘
- 船只能橫放或直放
- 開火結果：打中、沒打中；一艘船的每一格都被打中時會宣告「擊沉」，並把那艘船框起來。因為船之間一定分開，擊沉的船周圍會自動標上淡淡的點（那些格子一定是空的）
- 先擊沉對方所有船的人獲勝

### 幾A幾B

- **位數**：3、4（經典）、5 位
- **數字可否重複**：經典是不重複；也可以開「可以重複」（例如 1123）。0 可以放在第一位
- 雙方各自設一組密碼，輪流猜對方的密碼，每次會得到「幾A幾B」：A 是數字和位置都對，B 是數字對但位置不對。數字可以重複時，同一個數字最多算到雙方都有的次數（例如密碼 1123、猜 1111 是 2A0B）
- 先猜中對方密碼的人獲勝
- 對戰畫面有「數字筆記」，可以把確定沒有、確定有的數字標起來，只有自己看得到

### 對戰紀錄與 Google 登入

- 右上角「對戰紀錄」可以看每一局的勝負、對手、設定、開了幾砲（幾A幾B 是猜了幾次），也能依玩法篩選、看勝率
- 線上對戰在分出勝負的那一刻，由後端替雙方各寫一筆（中途離開也算，會標「對手中途離開」）；跟電腦練習打完一局也會記一筆，自己中途離開的不算
- 一進網站是**訪客**（Firebase 匿名登入，每個分頁一個身分），紀錄只留在那個分頁
- 按「用 Google 登入」會把訪客**升級**成 Google 帳號，uid 不變，所以登入前打完的局也會留著；之後換裝置登入同一個帳號也看得到。如果這個 Google 帳號以前就登入過，會直接切換到那個帳號（這個分頁的訪客紀錄就不會帶過去）
- Google 帳號會記在這台裝置上（所有分頁共用、關掉瀏覽器也不用重新登入）；登出後變回新的訪客
- 本機測試模式沒有真的 Google，按登入會用一個模擬的「測試帳號」（存在 localStorage，所以登入後每個分頁都是同一個人；要用兩個分頁自己跟自己對戰時記得先登出）
- 最多顯示最近 100 局
- 點任何一局可以看**詳細紀錄**（`#/history/紀錄編號`）：
  - 飛機版、海戰棋：雙方的棋盤和藏的位置，可以一步一步重播（上一步／下一步、拖曳、自動播放），點戰況紀錄跳到那一步
  - 幾A幾B：雙方的密碼和每一次猜測
  - 逐步紀錄存在每一筆對戰紀錄裡（`detail` 欄位）；列表 API 不帶它，點進去才用 `historyEntry` 拿。功能上線前打的局沒有逐步紀錄，只顯示摘要
  - 跟電腦練習的逐步紀錄由瀏覽器送來，後端會檢查格式，不對就只存摘要

### 排行榜與獎牌

- 右上角「排行榜」：**只算跟真人的對戰**，跟電腦練習不算進勝率
- 要用 Google 登入、跟真人打滿 3 場（`MIN_RANKED_GAMES`）才會上榜；名字固定用 Gmail 的 @ 前面那段（**會公開給所有人看**），不用房間裡取的暱稱
- 依勝率排，同勝率比勝場、再比場數；可以切換「全部／飛機版／海戰棋／幾A幾B」。3 場是三種玩法合計，上榜後只要跟真人玩過某個玩法，就會出現在那個玩法的榜上
- 名字後面顯示拿到的獎牌（越稀有越前面，最多 3 面，其餘顯示 +N），點一下看獎牌名稱和條件
- 共 25 面獎牌，分普通（銅、銀色圓牌）、稀有（六角、緞帶、菱形）、史詩（盾牌、星形）、傳說（皇冠、發光）四級；定義和條件都在 `shared/src/medals.ts`，圖案在 `web/src/components/Medal.tsx`
- 一局結束時後端算戰績和獎牌（`applyResult`，同一局只算一次），勝負彈窗會顯示「新獎牌！」
- 訪客也會累積戰績和獎牌，登入 Google 後一起帶進帳號
- 跟電腦有關的獎牌（勤奮練習生、電腦剋星、人機大戰冠軍）是用瀏覽器回報的練習結果算的，懂程式的人可以造假；它們不影響勝率和排名

### 共通規則

- 聊天：雙方都進房後，右下角有聊天按鈕，可以按快捷句（太慢了！、我會贏喔！、好險！、厲害！、哈哈哈、可惡！）或自己打字（最多 40 字）。對方說話時畫面上方會跳出泡泡；可以勾選「隱藏對方打的字」
- 「太慢了！」＝戳對方一下：輪到對方、或自己已經擺好／設好密碼在等對方時，色帶旁邊會出現這個按鈕。對方的畫面會晃一下、手機會震動；同一個人 5 秒內只能戳一次，每則訊息至少隔 1 秒
- 跟電腦練習時，電腦也會回你的話；輪到你超過 30 秒，電腦會戳你（每回合最多一次）

- 邀請連結：拿到連結的人都可以坐上空位（先到先坐）；兩個人都進房後，其他人只會看到「房間已滿」。房裡的兩個人隨時可以用同一個連結回來
- 房間超過 24 小時沒有任何動作就會過期：邀請連結不能再加入，也不能再下棋（還看得到最後的棋盤）；房主在沒人加入前離開，房間會立刻關閉
- 邀請連結帶有 `?openExternalBrowser=1`，在 LINE 聊天室點開時會改用手機的預設瀏覽器。在 LINE、Facebook、Instagram 等 App 的內建瀏覽器裡可以用訪客身分玩，但 Google 不允許在那裡登入，頁面上方會提示怎麼改用瀏覽器
- 訪客玩到一半才用「以前登入過的 Google 帳號」登入時，座位和這個分頁的對戰紀錄會一起搬到帳號底下；如果那個帳號就是房間裡的對手（同一個人開兩邊測試），會留在訪客身分並提示換一個帳號

- **格子數量**（飛機版、海戰棋）：5×5 到 12×12。放不下的組合會提示，後端也會用同一套演算法再檢查一次
- **棋子要完全分開**：兩個以上時，飛機或船之間不能重疊、不能上下左右相鄰，斜角也不能碰到。想改成「斜角可以碰」，把 `shared/src/plane.ts` 的 `NO_DIAGONAL_TOUCH` 改成 `false`
- 回合：每一發都換人。第一局隨機先攻，之後每局換另一個人先攻
- 離開：對戰中離開房間算輸
- 標記：灰色叉叉＝沒打中、綠色圈圈＝打中（機身或船）、紅色「頭」印章＝打中機頭、紅框＝擊沉的船
- 推理筆記：在對手棋盤按右鍵（手機用「標記模式」）可以點上淡灰色小點，只存在自己的分頁

要調整的話，改這幾個地方：預設飛機形狀在 `shared/src/shapes.ts` 的 `SHAPE_PRESETS`（用 `H` / `#` / `.` 畫），預設艦隊在同一個檔案的 `FLEET_PRESETS`，棋盤與數量範圍在 `shared/src/plane.ts` 的 `MIN_SIZE`、`MAX_SIZE`、`MAX_PLANES`。改完跑 `npm test`，前後端會一起套用。

字型使用 justfont 的開源圓體「粉圓」（`@fontsource/huninn`），字型檔會跟著網站一起部署，不需要連到 Google Fonts。

---

## 部署上線

| 部分 | 服務 | 費用 |
| --- | --- | --- |
| 網頁 + 裁判後端 | Vercel Hobby 方案（每月 100 萬次函式呼叫、4 小時 CPU） | 免費（限非商業用途） |
| 登入 + 資料庫 + 即時同步 | Firebase Spark 方案（Firestore 每天 5 萬次讀取、2 萬次寫入） | 免費，不用綁卡 |

完整步驟（從建立 Firebase 專案到網站上線）請看 **[DEPLOY.md](DEPLOY.md)**。

---

## 已知限制與之後可以加的功能

- 對手直接關掉分頁時，不會自動判輸（房間會停在那裡）。之後可以加「在線狀態」或回合計時
- 本機模式的房間存在記憶體，重啟伺服器就會清空（Firebase 模式不會）
- Firestore 房間文件帶有 `expireAt` 欄位，可以在 Firebase 後台設定 TTL 政策讓過期房間自動刪除
- 訪客（沒登入 Google）的對戰紀錄也會寫進 Firestore，關掉分頁後就沒人讀得到；量很小，之後需要的話可以定期清掉沒登入過的 uid
