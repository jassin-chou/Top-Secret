# 部署上線：Vercel + Firebase

照著這份做完，網站會在 `https://<你取的名字>.vercel.app` 上線，朋友用手機或電腦打開就能玩。全部用免費方案，不用綁信用卡。

大約需要 30 分鐘。每一步做完都有「確認」可以檢查。

---

## 架構一覽

```
 朋友的瀏覽器
   │  https://<名字>.vercel.app
   ▼
 Vercel（Hobby 免費方案）
   ├─ 網頁：React 前端（靜態檔案，放在全球 CDN）
   └─ /api/…：裁判後端（Vercel Function，放在香港機房 hkg1）
                │  用服務帳戶金鑰（Admin SDK）讀寫
                ▼
 Firebase（Spark 免費方案）
   ├─ Authentication：訪客（匿名）登入、Google 登入
   └─ Firestore（台灣機房 asia-east1）：房間、雙方的祕密、對戰紀錄
        ▲
        └─ 瀏覽器直接「監聽」房間的變化（只能讀，不能寫；規則在 firestore.rules）
```

| 放在哪裡 | 做什麼 | 設定在哪裡 |
| --- | --- | --- |
| Vercel 靜態檔案 | 網頁畫面 | 建置時由 `scripts/build-vercel.mjs` 產生 |
| Vercel Function `/api` | 開房、擺放、開火、猜數字、判勝負、寫對戰紀錄 | `server/src/vercel.ts` |
| Firebase Authentication | 每個人的身分（訪客或 Google） | Firebase 主控台 |
| Firestore | 所有資料 | Firebase 主控台 |

為什麼要有後端：對手看不到你的飛機和密碼，是因為只有後端拿得到完整資料、所有寫入都由後端判定。瀏覽器只能讀「公開的棋局」和「自己的祕密」。

網頁和 API 在同一個網域，所以不用設定 CORS。後端放香港、資料庫放台灣，每一步棋的來回都很短。

---

## 事前準備

- **一個個人 Google 帳號（Gmail）**：用來建 Firebase 專案。公司或學校的 Google 帳號有時會被管理員擋掉下載金鑰，用個人帳號最穩。
- **一個 GitHub 帳號**：用來登入 Vercel（也可以用 Email 註冊）。
- **專案程式碼**：把 `plane-hunt.zip` **解壓縮到一個全新的資料夾**，不要蓋在舊版上面。舊版裡有一個 `api` 資料夾，新版已經改名成 `server`；如果舊的 `api` 資料夾還在，Vercel 會把它當成另一組函式，部署就會出錯。
- **Node.js 22**：公司電腦用免安裝版即可（README 的「電腦不能安裝 Node.js 時」）。

下面的指令都是 Windows PowerShell。每開一個新的 PowerShell 視窗，都先執行這兩行：

```powershell
# 讓 PowerShell 找得到免安裝版的 Node.js（有正式安裝 Node.js 的電腦可以跳過這行）
$env:Path = (Get-ChildItem "$HOME\node-portable" -Recurse -Filter node.exe | Select-Object -First 1).DirectoryName + ";" + $env:Path

# 換到專案資料夾（改成你解壓縮的位置；裡面要看得到 package.json、DEPLOY.md）
cd $HOME\Downloads\top-secret\plane-hunt
```

第一次在這個資料夾，先安裝套件並確認本機能跑：

```powershell
npm.cmd install
npm.cmd test
```

**確認**：最後看到兩段 `# fail 0`。

---

## 第 1 步：建立 Firebase 專案

打開 <https://console.firebase.google.com>，用你的 Google 帳號登入。

### 1-1 建立專案

1. 按「建立專案」（Create a project）。
2. 專案名稱：例如 `top-secret-game`。下方會顯示**專案 ID**（可能自動加上幾個字），記下來，後面會一直用到。
3. Google Analytics：**關掉**（用不到）。
4. 按「建立專案」，等它跑完。

**確認**：進到專案首頁，左上角顯示你的專案名稱；左下角方案是 **Spark**（免費）。

### 1-2 開啟兩種登入方式

1. 左邊選單：「建構」（Build）→「Authentication」→「開始使用」。
2. 「登入方式」（Sign-in method）分頁 →「新增供應商」：
   - 選「**匿名**」→ 打開「啟用」→ 儲存。
   - 再按一次「新增供應商」→ 選「**Google**」→ 打開「啟用」→「專案支援電子郵件」選你的 Gmail → 儲存。

**確認**：登入方式清單裡，「匿名」和「Google」都是「已啟用」。

> 少了「匿名」，網站一打開就會連不上；少了「Google」，對戰紀錄頁的登入按鈕會失敗。

### 1-3 建立 Firestore 資料庫，貼上安全規則

1. 左邊選單：「建構」→「Firestore Database」→「建立資料庫」。
2. 如果要選版本（edition），選「**Standard**」（標準版）。
3. 資料庫 ID：保留預設的 **`(default)`**，不要改。
4. 位置（Location）：選 **`asia-east1 (Taiwan)`**。這個之後不能改，選錯只能刪掉重建。
5. 安全規則：選「**以正式版模式啟動**」（Start in production mode）→ 建立。
6. 建好後切到「**規則**」（Rules）分頁，把裡面的內容**全部刪掉**，換成專案裡 `firestore.rules` 的內容（用記事本打開、全選、複製、貼上）→ 按「**發布**」（Publish）。

**確認**：規則分頁第一行是 `rules_version = '2';`，而且看得到 `match /games/{gameId}`。

### 1-4 註冊網頁應用程式，抄下三個值

1. 左上角齒輪 →「專案設定」（Project settings）→「一般」（General）分頁。
2. 往下捲到「你的應用程式」→ 按網頁圖示 **`</>`**。
3. 應用程式暱稱：例如 `web`。「同時為這個應用程式設定 Firebase Hosting」**不要勾** → 註冊應用程式。
4. 畫面會出現一段 `const firebaseConfig = { ... }`，把這三個值記到記事本：

| firebaseConfig 裡的欄位 | 等一下要填的環境變數 |
| --- | --- |
| `apiKey`（`AIza` 開頭） | `VITE_FIREBASE_API_KEY` |
| `projectId` | `VITE_FIREBASE_PROJECT_ID` |
| `appId`（`1:` 開頭） | `VITE_FIREBASE_APP_ID` |

其他欄位用不到。這三個值本來就會出現在網頁裡，不是祕密。

### 1-5 下載服務帳戶金鑰（這個是祕密）

1. 一樣在「專案設定」→ 切到「**服務帳戶**」（Service accounts）分頁。
2. 選「Firebase Admin SDK」→ 按「**產生新的私密金鑰**」→「產生金鑰」。
3. 會下載一個 JSON 檔，檔名類似 `top-secret-game-firebase-adminsdk-xxxxx-1234567890.json`。

> **這個檔案等於你整個資料庫的萬能鑰匙**：不要傳給別人、不要上傳到 GitHub、不要放進專案資料夾。等一下只會把它的內容貼到 Vercel 的環境變數裡。專案的 `.gitignore` 和 `.vercelignore` 都已經排除這種檔名，萬一放錯地方也不會被上傳。

**確認**：用記事本打開這個檔案，看得到 `"type": "service_account"`、`"project_id"`（要跟 1-1 的專案 ID 一樣）、`"private_key"`。

---

## 第 2 步：建立 Vercel 專案

### 2-1 註冊 Vercel

打開 <https://vercel.com/signup>，方案選 **Hobby**（免費），用 GitHub 帳號註冊（或 Email）。

### 2-2 在專案資料夾登入，建立專案

在 PowerShell（已經 `cd` 到專案資料夾）：

```powershell
npx.cmd vercel@latest login
```

第一次會問要不要安裝 `vercel` 套件，輸入 `y`。接著選登入方式（例如 Continue with GitHub），它會打開瀏覽器，按確認後回到 PowerShell。

**確認**：PowerShell 顯示 `Congratulations! You are now logged in.`（或類似的成功訊息）。

接著建立 Vercel 專案（**只建立、還不部署**）：

```powershell
npx.cmd vercel@latest link
```

照下面回答（不同版本的問法可能略有不同，意思一樣就好）：

| 它問 | 回答 |
| --- | --- |
| Set up “…plane-hunt”? | `y` |
| Which scope should contain your project? | 選你自己的帳號 |
| Link to existing project? / Link to it? | `n`（第一次） |
| What’s your project’s name? | 例如 `top-secret-game`（會變成網址 `top-secret-game.vercel.app`；被用走的話 Vercel 會自動加後綴） |
| In which directory is your code located? | 直接 Enter（`./`） |
| Want to modify these settings? | `n`（設定已經寫在 `vercel.json`） |
| 問要不要 pull 環境變數、連 Git 之類 | `n` |

**確認**：專案資料夾裡多了一個 `.vercel` 資料夾；<https://vercel.com/dashboard> 看得到新專案。

### 2-3 設定環境變數（4 個）

1. 到 <https://vercel.com/dashboard> → 點你的專案 → 上方「**Settings**」→ 左邊「**Environment Variables**」。
2. 一個一個新增（Key 填左欄、Value 填右欄），**Environments 勾 Production 和 Preview**：

| Key | Value |
| --- | --- |
| `VITE_FIREBASE_API_KEY` | 1-4 的 `apiKey` |
| `VITE_FIREBASE_PROJECT_ID` | 1-4 的 `projectId` |
| `VITE_FIREBASE_APP_ID` | 1-4 的 `appId` |
| `FIREBASE_SERVICE_ACCOUNT` | 1-5 下載的 JSON 檔**整個內容**：記事本打開 → Ctrl+A → Ctrl+C → 貼上（從第一個 `{` 到最後一個 `}`，換行沒關係） |

3. `FIREBASE_SERVICE_ACCOUNT` 建議打開「**Sensitive**」，存了之後連你自己都看不到內容，比較安全。
4. 每一個都按「Save」。

只要這 4 個。下面這些建置程式會自動處理，**不用**設定：

- `VITE_BACKEND`、`VITE_API_BASE`、`VITE_FIREBASE_AUTH_DOMAIN`（自動用 `<專案ID>.firebaseapp.com`）

**確認**：Environment Variables 清單有 4 筆，Environments 欄都寫著 Production、Preview。

> 填錯不用怕：建置程式會先檢查。少了哪一個、金鑰格式不對、金鑰跟專案 ID 對不起來，部署時都會直接用中文告訴你哪裡錯。

---

## 第 3 步：部署

```powershell
npx.cmd vercel@latest --prod
```

它會把程式碼上傳到 Vercel（`node_modules` 不會上傳），在 Vercel 的機器上安裝套件、建置前端、打包後端，大約 1～2 分鐘。

**確認**：最後幾行會看到

```
✅  Production: https://top-secret-game-xxxxxxxx-你的帳號.vercel.app
🔗  Aliased: https://top-secret-game.vercel.app
```

**正式網址是 `Aliased` 那個短的**（也可以在專案頁的「Domains」看到）。長的那個網址帶著部署編號，Vercel 預設只讓你自己登入後看得到，朋友打開會被要求登入 Vercel，所以分享時一定用短的。

---

## 第 4 步：把網址加到 Firebase 的授權網域

Google 登入只允許在授權過的網址使用。

1. Firebase 主控台 → Authentication →「**設定**」（Settings）分頁 →「**授權網域**」（Authorized domains）。
2. 「新增網域」→ 填 `top-secret-game.vercel.app`（換成你的短網址，**不要**加 `https://`）→ 新增。

**確認**：清單裡有 `localhost`、`<專案ID>.firebaseapp.com`、和你的 `.vercel.app` 網址。

---

## 第 5 步：確認上線

一項一項試：

1. 打開 `https://<你的網址>/api/health`，看到 `{"ok":true,"mode":"firebase"}` → 後端活著。
2. 打開 `https://<你的網址>`，左上角**沒有**「本機測試模式」字樣 → 前端用的是 Firebase。
3. 開新房間 → 選飛機版 →「建立房間」，進到等待頁、看到房號 → 匿名登入、後端、Firestore 都正常。
4. 用手機（或另一個瀏覽器）打開邀請連結 → 加入 → 兩邊擺好開打 → 即時同步正常。
5. 右上角「對戰紀錄」→「用 Google 登入」→ 選帳號 → 顯示你的名字和大頭貼 → Google 登入正常。
6. 打完一局，對戰紀錄頁出現那一局。
7. Firebase 主控台 → Firestore Database →「資料」分頁，看得到 `games` 和 `users` 集合。

全部通過就完成了，把短網址傳給朋友就能玩。

---

## 之後要更新網站

改完程式後，在專案資料夾（先跑「事前準備」那兩行）執行：

```powershell
npm.cmd test
npx.cmd vercel@latest --prod
```

幾分鐘後網址就是新版本。改錯了想退回：Vercel 專案頁 →「Deployments」→ 找到之前正常的那一版 →「…」→「Promote to Production」（或 Instant Rollback）。

---

## （選用）改成推到 GitHub 就自動部署

如果之後習慣用 Git：

1. 在 GitHub 建一個 repository（Private 也可以，Vercel Hobby 支援私人 repo），把專案推上去。專案的 `.gitignore` 已經排除 `node_modules`、`.vercel` 和金鑰檔。
2. Vercel 專案 → Settings →「Git」→「Connect Git Repository」→ 選那個 repo。
3. 之後每次推到 `main` 分支，Vercel 就會自動部署到正式網址；推到其他分支會產生預覽網址（所以環境變數要勾 Preview）。

---

## 常見問題

| 狀況 | 原因與解法 |
| --- | --- |
| 部署時出現「✗ 無法建置 Vercel 部署檔：缺少環境變數…」 | 照訊息到 Settings → Environment Variables 補上，再執行一次 `npx.cmd vercel@latest --prod` |
| 「FIREBASE_SERVICE_ACCOUNT 不是合法的 JSON」 | 貼的時候少了開頭或結尾。Vercel 裡刪掉那筆，重新整個貼上 |
| 「專案 ID 對不起來」 | 金鑰是別的 Firebase 專案的。確認 1-4 和 1-5 是同一個專案 |
| 部署時出現跟 region（機房）有關的錯誤 | 在環境變數加 `VERCEL_FUNCTION_REGION`，值填 `none`，重新部署；再到 Settings →「Functions」→ Function Region 選 Hong Kong（hkg1） |
| 打開網址被要求登入 Vercel | 你打開的是帶部署編號的長網址，改用 `Aliased` 的短網址 |
| 網站顯示「連不上遊戲伺服器」 | 先開 `/api/health` 看看；不正常的話到 Vercel 專案 →「Logs」看錯誤 |
| 開房間時跳出錯誤、Logs 有 `PERMISSION_DENIED` 或 `NOT_FOUND` | Firestore 還沒建立，或建在別的資料庫 ID。確認 1-3：資料庫 ID 是 `(default)` |
| 進房間後一直顯示錯誤「無法讀取房間：Missing or insufficient permissions」 | 1-3 第 6 步的安全規則沒有貼上或沒按「發布」 |
| 一打開網站就出錯，訊息有 `auth/admin-restricted-operation` 或 `operation-not-allowed` | 1-2 的「匿名」登入沒有啟用 |
| Google 登入跳出「這個網址還沒加到 Firebase 的授權網域」 | 第 4 步。網域要跟網址列上的一模一樣 |
| Google 登入跳出「瀏覽器擋住了登入視窗」 | 允許這個網站開啟彈出式視窗後再按一次 |
| 1-5 找不到「產生新的私密金鑰」或按了顯示被政策禁止 | 這個 Google 帳號屬於某個組織，管理員禁止下載金鑰。改用個人 Gmail 重新建立 Firebase 專案 |
| `npx.cmd vercel@latest login` 連不上 | 公司網路可能擋住了。換家裡的網路或手機熱點再試 |

---

## 費用與額度

| 服務 | 免費額度 | 超過時 |
| --- | --- | --- |
| Vercel Hobby | 每月 100 萬次函式呼叫、4 小時 CPU 時間、100 GB 流量 | 不會扣錢，專案可能被暫停到下個月；限非商業用途 |
| Firebase Spark | Firestore 每天 5 萬次讀取、2 萬次寫入、1 GiB 儲存；登入不限 | 不會扣錢，當天暫停讀寫，隔天恢復 |

以這個遊戲來估算，每天可以玩一百多局完整的對戰（讀取額度會先用完），跟朋友玩非常夠。Firebase 主控台的「Usage」頁、Vercel 專案的「Usage」頁都看得到用量。

（選用）讓過期房間自動刪除：Firestore →「TTL」（存留時間）→ 建立政策：集合群組 `games`、欄位 `expireAt`。

## 安全提醒

- 服務帳戶金鑰只存在 Vercel 的環境變數裡。如果不小心外流：Firebase 專案設定 → 服務帳戶 →「管理服務帳戶權限」→ 刪掉那把金鑰，再產生一把新的，更新 Vercel 的 `FIREBASE_SERVICE_ACCOUNT` 後重新部署。
- `firestore.rules` 讓瀏覽器只能讀、不能寫；改規則前先想清楚，別把寫入權限打開。
