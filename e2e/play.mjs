// 端對端實測：開兩個獨立瀏覽器身分，從開房間一路打到分出勝負，並截圖。
// 用法：先 npm run dev，再另開終端機執行 npm run e2e
// 需要 Playwright：npm i -D playwright && npx playwright install chromium
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.E2E_BASE ?? 'http://localhost:5173/';
const OUT = new URL('./screens/', import.meta.url).pathname;
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || undefined,
});
const ctxA = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
const A = await ctxA.newPage();
const B = await ctxB.newPage();
for (const [name, p] of [['A', A], ['B', B]]) {
  p.on('pageerror', (e) => console.error(`[${name} pageerror]`, e.message));
  p.on('console', (m) => m.type() === 'error' && !m.text().includes('fonts.g') && console.error(`[${name} console]`, m.text()));
}

const shot = (p, name) => p.screenshot({ path: `${OUT}${name}.png`, fullPage: true });
const step = (msg) => console.log('•', msg);

/** 點棋盤上的某一格（SVG 上有 data-size 與 data-margin，換算成螢幕座標） */
async function cellPoint(page, boardIndex, x, y) {
  const svg = page.locator('.board svg').nth(boardIndex);
  await svg.scrollIntoViewIfNeeded();
  const box = await svg.boundingBox();
  const [size, margin] = await svg.evaluate((el) => [Number(el.dataset.size), Number(el.dataset.margin)]);
  const unit = box.width / (size + margin + 0.1);
  return { x: box.x + (x + margin + 0.5) * unit, y: box.y + (y + margin + 0.5) * unit };
}
async function editorCell(page, x, y) {
  await page.locator(`[data-cell="${x},${y}"]`).click();
}
async function clickCell(page, boardIndex, x, y) {
  const pt = await cellPoint(page, boardIndex, x, y);
  await page.mouse.click(pt.x, pt.y);
}
async function tapCell(page, boardIndex, x, y) {
  const pt = await cellPoint(page, boardIndex, x, y);
  await page.touchscreen.tap(pt.x, pt.y);
}

/** 直接用該分頁的 token 問 API 自己的飛機位置（測試用來「作弊」決定要打哪裡） */
async function myPlanes(page, code) {
  return page.evaluate(async (gameId) => {
    const token = sessionStorage.getItem('planehunt.localToken');
    const r = await fetch('/api/state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ gameId }),
    });
    return (await r.json()).me.planes;
  }, code);
}

try {
  // ---------- 首頁 ----------
  step('A 打開首頁');
  await A.goto(BASE);
  await A.getByRole('heading', { name: '絕對機密' }).waitFor();
  await shot(A, '01-home-desktop');
  await B.goto(BASE);
  await B.getByRole('heading', { name: '絕對機密' }).waitFor();
  await shot(B, '01-home-mobile');

  step('A 沒填暱稱就按開新房間 → 應該提示');
  await A.getByRole('button', { name: /開新房間/ }).click();
  await A.getByText('先取個暱稱，對手才知道你是誰').first().waitFor();

  step('A 填暱稱 → 開新房間 → 選玩法頁，打開「飛機版怎麼玩」');
  await A.getByLabel('先取個暱稱').fill('阿明');
  await A.getByRole('button', { name: /開新房間/ }).click();
  await A.getByRole('heading', { name: '阿明，想玩哪一種？' }).waitFor();
  await A.getByRole('button', { name: '飛機版怎麼玩' }).click();
  await A.getByRole('heading', { name: '飛機版怎麼玩' }).waitFor();
  await shot(A, '01c-howto');
  await A.getByRole('button', { name: '知道了' }).click();
  await A.getByRole('heading', { name: '飛機版怎麼玩' }).waitFor({ state: 'hidden' });
  await shot(A, '01d-mode');
  await A.locator('.mode-big', { hasText: '飛機版' }).click();
  await A.getByRole('heading', { name: '飛機版設定' }).waitFor();

  step('5×5 的棋盤放經典飛機只能放 1 架');
  await A.getByRole('radio', { name: '5×5' }).check();
  await A.getByText('這個大小最多放得下 1 架').waitFor();
  if (!(await A.getByRole('radio', { name: '2 架' }).isDisabled())) throw new Error('2 架應該被停用');
  await A.getByRole('radio', { name: /客機/ }).check();
  await A.getByText('「客機」至少要 7×7 的棋盤').waitFor();
  if (!(await A.getByRole('button', { name: '開房間' }).isDisabled())) throw new Error('放不下時不能開房');

  step('A 自己畫一架「火箭」');
  await A.getByRole('radio', { name: /自己畫/ }).check();
  await A.locator('.editor-grid').waitFor();
  await A.getByRole('button', { name: '全部擦掉' }).click();
  await A.getByText('還沒放機頭').waitFor();
  for (const [x, y] of [[3, 2], [2, 3], [3, 3], [4, 3], [3, 4]]) await editorCell(A, x, y);
  await A.getByRole('radio', { name: '放機頭' }).check();
  await editorCell(A, 3, 1);
  await A.getByRole('radio', { name: '畫機身' }).check();
  await editorCell(A, 6, 6); // 沒連在一起
  await A.getByText('每一格都要連在一起').first().waitFor();
  await editorCell(A, 6, 6); // 擦掉
  await A.getByLabel('幫它取個名字').fill('火箭');
  await A.getByText('「火箭」共 6 格').waitFor();
  await A.getByRole('radio', { name: '7×7' }).check();
  await A.getByRole('radio', { name: '2 架' }).check();
  await A.getByText('7×7 方格，每人 2 架「火箭」').waitFor();
  await shot(A, '01b-create-custom');
  await A.getByRole('button', { name: '開房間' }).click();
  await A.getByText('等朋友加入中').waitFor();
  await A.getByText('每人 2 架「火箭」').waitFor();
  const code = (await A.url()).split('#/r/')[1];
  step(`房號 ${code}`);
  await shot(A, '02-waiting');

  step('邀請連結帶著 ?openExternalBrowser=1（LINE 會改用手機瀏覽器開）');
  const invite = await A.evaluate((c) => {
    // 跟「複製邀請連結」用的是同一個格式
    return `${location.origin}${location.pathname}?openExternalBrowser=1#/r/${c}`;
  }, code);

  step('從 LINE 內建瀏覽器打開：上方有提醒，按 Google 登入不會開彈窗、改成提示');
  const ctxL = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/14.0.0',
  });
  const L = await ctxL.newPage();
  await L.goto(invite);
  await L.getByText('阿明找你來玩尋機頭').waitFor();
  await L.getByText('你正在 LINE 的內建瀏覽器裡').waitFor();
  const openHref = await L.getByRole('link', { name: '用瀏覽器開啟' }).getAttribute('href');
  if (!openHref.includes('openExternalBrowser=1') || !openHref.includes(`#/r/${code}`)) throw new Error('「用瀏覽器開啟」網址不對：' + openHref);
  await L.getByRole('button', { name: '登入' }).click();
  await L.locator('.toast', { hasText: '內建瀏覽器不能用 Google 登入' }).waitFor();
  if (ctxL.pages().length !== 1) throw new Error('在 LINE 裡不該跳出登入視窗');
  await shot(L, '02b-line-inapp');
  await ctxL.close();

  step('邀請過了 24 小時沒人加入 → 顯示已過期（把瀏覽器時間調快 25 小時）');
  const ctxOld = await browser.newContext();
  await ctxOld.addInitScript(() => {
    const shift = 25 * 60 * 60 * 1000;
    const realNow = Date.now.bind(Date);
    Date.now = () => realNow() + shift;
  });
  const Old = await ctxOld.newPage();
  await Old.goto(invite);
  await Old.getByRole('heading', { name: '這個邀請已經過期了' }).waitFor();
  if (await Old.getByRole('button', { name: '加入房間' }).count()) throw new Error('過期的邀請不該還能加入');
  await ctxOld.close();

  // ---------- B 從邀請連結加入 ----------
  step('B 打開邀請連結');
  await B.goto(invite);
  await B.getByText('阿明找你來玩尋機頭').waitFor();
  await shot(B, '03-join-mobile');
  await B.getByLabel('你的暱稱').fill('小華');
  await B.getByRole('button', { name: '加入房間' }).click();

  // ---------- 擺放 ----------
  await A.getByRole('heading', { name: '藏好你的飛機' }).waitFor();
  await B.getByRole('heading', { name: '藏好你的飛機' }).waitFor();
  step('雙方進入擺放階段（A 沒有重新整理就自動切換）');

  step('A 用鍵盤擺第一架（方向鍵移動、Enter 放下）');
  await A.locator('.board svg').first().focus();
  await A.locator('.board.is-kbd').waitFor();
  for (let i = 0; i < 3; i++) await A.keyboard.press('ArrowUp'); // (3,3) → (3,0)
  for (let i = 0; i < 2; i++) await A.keyboard.press('ArrowLeft'); // → (1,0)
  await A.keyboard.press('Enter');
  await A.getByText('已擺 1 / 2 架').waitFor();

  step('A 用滑鼠擺第二架：斜角碰到會被擋下，隔開就可以');
  const bad = await cellPoint(A, 0, 4, 1);
  await A.mouse.move(bad.x, bad.y);
  await A.locator('.plane--invalid').waitFor();
  await shot(A, '04-placing-touch');
  await A.mouse.click(bad.x, bad.y);
  await A.locator('.toast', { hasText: '飛機之間要完全分開' }).waitFor();
  const p = await cellPoint(A, 0, 5, 0);
  await A.mouse.move(p.x, p.y);
  await A.locator('.plane--ghost').waitFor();
  if (await A.locator('.board.is-kbd').count()) throw new Error('滑鼠移動後不應該顯示鍵盤外框');
  await A.mouse.click(p.x, p.y);
  await A.getByText('已擺 2 / 2 架').waitFor();
  // 點已放好的飛機 → 拿起來，再放回去
  await clickCell(A, 0, 5, 1);
  await A.getByText('已擺 1 / 2 架').waitFor();
  await clickCell(A, 0, 5, 0);
  await A.getByText('已擺 2 / 2 架').waitFor();
  await shot(A, '05-placing-full');
  await A.getByRole('button', { name: '擺好了，準備開戰' }).click();
  await A.getByText('你已經擺好了').waitFor();

  step('B 在手機上：點兩下放一架；隨機補不下時會整盤重擺');
  await tapCell(B, 0, 3, 2);
  await tapCell(B, 0, 3, 2); // 放在正中間，剩下的空間擺不下第二架
  await B.getByText('已擺 1 / 2 架').waitFor();
  await B.getByRole('button', { name: '隨機擺放' }).click();
  await B.getByText('已擺 2 / 2 架').waitFor();
  await B.locator('.toast', { hasText: '整盤重新擺放' }).waitFor();
  await B.getByText('阿明已經擺好了').waitFor();
  await shot(B, '06-placing-mobile');

  step('聊天：A 擺好了在等 B → 按「太慢了！」戳 B；B 看到泡泡、聊天按鈕有未讀');
  await A.getByRole('button', { name: '戳小華一下：太慢了！' }).click();
  await B.locator('.chat-bubble--poke', { hasText: '阿明戳了你一下' }).waitFor();
  await B.getByRole('button', { name: '聊天（1 則新訊息）' }).waitFor();
  await shot(B, '06b-poked-mobile');
  await A.locator('.poke-btn:disabled', { hasText: '催了！' }).waitFor(); // 冷卻中不能連按
  if (await B.getByRole('button', { name: /太慢了/ }).count()) throw new Error('B 還沒擺好，不該能催 A');

  step('B 打開聊天，自己打字回 A；A 收到泡泡；A 隱藏對方打的字');
  await B.getByRole('button', { name: '聊天（1 則新訊息）' }).click();
  await B.locator('.chat-msg--poke', { hasText: '太慢了！' }).waitFor();
  await B.getByLabel('自己打字').fill('  馬上好啦  ');
  await B.getByRole('button', { name: '送出' }).click();
  await B.locator('.chat-msg--mine', { hasText: '馬上好啦' }).waitFor();
  if ((await B.getByLabel('自己打字').inputValue()) !== '') throw new Error('送出後輸入框要清空');
  await A.locator('.chat-bubble', { hasText: '馬上好啦' }).waitFor();
  await shot(A, '06c-chat-bubble');
  await A.getByRole('button', { name: /^聊天/ }).click();
  await A.getByLabel(/隱藏對方打的字/).check();
  await A.getByText('（已隱藏對方打的字）').waitFor();
  await A.getByLabel(/隱藏對方打的字/).uncheck();
  await A.getByRole('button', { name: '關閉聊天' }).click();
  await B.getByRole('button', { name: '關閉聊天' }).click();
  await B.getByRole('button', { name: '擺好了，準備開戰' }).click();

  // ---------- 對戰 ----------
  await A.locator('.battle').waitFor();
  await B.locator('.battle').waitFor();
  step('開戰；A 重新整理頁面，身分與棋局都還在');
  await A.reload();
  await A.locator('.battle').waitFor();

  const planesA = await myPlanes(A, code);
  const planesB = await myPlanes(B, code);
  const isATurn = async () => (await A.locator('.banner--mine').count()) > 0;

  // 先攻的人前兩發故意打空，看看各種標記
  const missesA = [[0, 6], [6, 6], [3, 3], [1, 1]].filter(([x, y]) => !planesB.some((pl) => pl.x === x && pl.y === y));
  let aMoves = [...missesA.slice(0, 2).map(([x, y]) => ({ x, y })), ...planesB.map((pl) => ({ x: pl.x, y: pl.y }))];
  // B 從右下角往回掃，避開 A 的機頭（不然可能提早結束）
  const bMoves = [];
  for (let i = 48; i >= 0; i--) {
    const m = { x: i % 7, y: Math.floor(i / 7) };
    if (!planesA.some((pl) => pl.x === m.x && pl.y === m.y)) bMoves.push(m);
  }

  // A 先做一個鉛筆記號（右鍵）
  const mk = await cellPoint(A, 0, 6, 0);
  await A.mouse.click(mk.x, mk.y, { button: 'right' });

  let turns = 0;
  let tookA = false;
  let tookB = false;
  while (turns < 30) {
    turns++;
    const status = await A.locator('.banner').getAttribute('class');
    if (status.includes('win') || status.includes('lose')) break;
    if (await isATurn()) {
      const m = aMoves.shift();
      if (!m) throw new Error('A 沒步可走了');
      const before = await A.locator('.enemy .shot').count();
      await clickCell(A, 0, m.x, m.y);
      await A.waitForFunction((n) => document.querySelectorAll('.enemy .shot').length > n, before);
      if (!tookA && turns >= 3) {
        tookA = true;
        await shot(A, '07-battle-desktop');
      }
    } else if ((await B.locator('.banner--mine').count()) > 0) {
      const m = bMoves.shift();
      const before = await B.locator('.enemy .shot').count();
      await tapCell(B, 0, m.x, m.y); // 第一下瞄準
      if (!tookB && turns >= 2) {
        tookB = true;
        await shot(B, '08-battle-mobile-aim');
      }
      await tapCell(B, 0, m.x, m.y); // 第二下開火
      await B.waitForFunction((n) => document.querySelectorAll('.enemy .shot').length > n, before);
    } else {
      await A.waitForTimeout(100);
    }
  }

  await A.locator('.banner--win').waitFor();
  await B.locator('.banner--lose').waitFor();
  step('雙方都跳出勝負彈窗');
  await A.getByRole('dialog', { name: '你贏了！' }).waitFor();
  await B.getByRole('dialog', { name: '這局輸了' }).waitFor();
  step('A 找齊 2 個機頭獲勝，彈窗裡拿到第一面獎牌');
  await A.getByRole('dialog').getByText('新獎牌！').waitFor({ timeout: 8000 });
  await A.getByRole('dialog').getByText('初登場勝利').waitFor();
  await A.waitForTimeout(600);
  await shot(A, '09-finished-desktop');
  await shot(B, '10-finished-mobile');

  // ---------- 再來一局 ----------
  step('雙方同意再來一局');
  await B.getByRole('button', { name: '再來一局' }).click();
  await A.getByRole('button', { name: '小華想再來一局，接受' }).click();
  await A.getByRole('heading', { name: '藏好你的飛機' }).waitFor();
  await A.getByText('已擺 2 / 2 架').waitFor(); // 上一局擺法被帶進來
  await A.getByText('第 2 局').waitFor();

  step('B 離開 → A 直接獲勝');
  await B.getByRole('button', { name: '離開房間' }).click();
  await B.getByRole('button', { name: /確定離開/ }).click();
  await B.getByRole('heading', { name: '絕對機密' }).waitFor();
  await A.getByText('小華離開了，這局算你贏').waitFor();
  await A.getByText('小華已經離開房間').waitFor();
  await shot(A, '11-forfeit');

  step('第三個人用同一個連結 → 看到房間已滿；用房號加入 → 提示已滿');
  const ctxC = await browser.newContext();
  const C = await ctxC.newPage();
  await C.goto(`${BASE}#/r/${code}`);
  await C.getByText('這個房間已經有兩位玩家了').waitFor();
  await C.goto(BASE);
  await C.getByLabel('先取個暱稱').fill('路人');
  await C.getByRole('button', { name: /加入朋友的房間/ }).click();
  await C.getByRole('heading', { name: '加入朋友的房間' }).waitFor();
  await shot(C, '11b-join-step');
  await C.getByLabel('房號').fill(code.toLowerCase());
  await C.getByRole('button', { name: '加入房間' }).click();
  await C.locator('.toast', { hasText: '房間已經滿了' }).waitFor();
  await C.getByRole('button', { name: '返回' }).click();
  await C.getByRole('heading', { name: '絕對機密' }).waitFor();

  // ---------- 海戰棋：跟電腦練習（手機畫面）----------
  step('海戰棋跟電腦練習：小艦隊（3、2、2）、7×7、普通');
  const ctxP = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const P = await ctxP.newPage();
  P.on('pageerror', (e) => console.error('[P pageerror]', e.message));
  await P.goto(BASE);
  await P.getByLabel('先取個暱稱').fill('小美');
  await P.getByRole('button', { name: /開新房間/ }).click();
  await P.locator('.mode-big', { hasText: '海戰棋' }).click();
  await P.getByRole('heading', { name: '海戰棋設定' }).waitFor();
  await P.getByRole('radio', { name: /小艦隊/ }).check();
  await P.getByRole('radio', { name: '7×7' }).check();
  await P.getByText('7×7 方格，每人 3 艘船，共 7 格').waitFor();
  // 自訂艦隊：加一艘超級航艦（6 格）在 7×7 也放得下；大艦隊在 6×6 放不下
  await P.getByRole('radio', { name: /大艦隊/ }).check();
  await P.getByRole('radio', { name: '6×6' }).check();
  await P.getByText('放不下這支艦隊').waitFor();
  if (!(await P.getByRole('button', { name: '跟電腦練習' }).isDisabled())) throw new Error('放不下時不能開始');
  await P.getByRole('radio', { name: /小艦隊/ }).check();
  await P.getByRole('radio', { name: '7×7' }).check();
  await shot(P, '12-ship-create');
  await P.getByRole('radio', { name: '普通' }).check();
  await P.getByRole('button', { name: '跟電腦練習' }).click();
  await P.getByRole('heading', { name: '佈置你的艦隊' }).waitFor();
  await P.getByText('電腦（普通）已經擺好了').waitFor();
  const pcode = P.url().split('#/p/')[1];

  step('擺船：第一艘改成直的放在 A1，其他隨機');
  await P.getByRole('button', { name: '改成直的' }).click();
  await tapCell(P, 0, 0, 0);
  await tapCell(P, 0, 0, 0);
  await P.getByText('已擺 1 / 3 艘').waitFor();
  // 第二艘緊貼著第一艘會被擋下
  await tapCell(P, 0, 1, 0);
  await tapCell(P, 0, 1, 0);
  await P.locator('.toast', { hasText: '完全分開' }).waitFor();
  await P.getByRole('button', { name: '隨機擺放' }).click();
  await P.getByText('已擺 3 / 3 艘').waitFor();
  await shot(P, '13-ship-placing');
  await P.getByRole('button', { name: '擺好了，準備開戰' }).click();
  await P.locator('.battle').waitFor();

  const botShips = await P.evaluate((id) => {
    const g = JSON.parse(sessionStorage.getItem(`planehunt.practice.${id}`));
    const fleet = g.rec.pub.settings.fleet;
    const step = { up: [0, 1], left: [1, 0], right: [-1, 0], down: [0, -1] };
    return g.rec.priv.p_bot.planes.map((p, i) =>
      Array.from({ length: fleet[i] }, (_, k) => ({ x: p.x + step[p.dir][0] * k, y: p.y + step[p.dir][1] * k })),
    );
  }, pcode);
  const shipCells = new Set(botShips.flat().map((c) => `${c.x},${c.y}`));

  const myTurn = () => P.locator('.banner--mine').count();
  const over = () => P.locator('.banner--win, .banner--lose').count();
  const waitMyTurn = async () => {
    for (let i = 0; i < 60 && !(await myTurn()) && !(await over()); i++) await P.waitForTimeout(100);
  };
  const fireAt = async (c) => {
    const before = await P.locator('.enemy .shot').count();
    await tapCell(P, 0, c.x, c.y);
    await tapCell(P, 0, c.x, c.y);
    await P.waitForFunction((n) => document.querySelectorAll('.enemy .shot').length > n, before);
  };

  step('先打一發空的，等電腦回擊，再重新整理確認可以續玩');
  await waitMyTurn();
  let probe = null;
  for (let i = 0; i < 49 && !probe; i++) {
    const c = { x: i % 7, y: Math.floor(i / 7) };
    if (!shipCells.has(`${c.x},${c.y}`)) probe = c;
  }
  await fireAt(probe);
  await P.locator('.mine .shot').first().waitFor({ timeout: 5000 });
  await P.reload();
  await P.locator('.battle').waitFor();

  step('把電腦的船一艘一艘打沉');
  let sawSunk = false;
  for (const ship of botShips) {
    for (const c of ship) {
      if (await over()) break;
      await waitMyTurn();
      if (await over()) break;
      await fireAt(c);
    }
    if (!sawSunk && (await P.locator('.log-item--sunk').count())) {
      sawSunk = true;
      await P.locator('.fleet-status li.is-sunk').first().waitFor();
      await shot(P, '14-ship-battle');
    }
  }
  await P.locator('.banner--win, .banner--lose').waitFor({ timeout: 10000 });
  if (!sawSunk && (await P.locator('.banner--win').count())) throw new Error('應該看到擊沉紀錄');
  await P.locator('dialog.result[open]').waitFor();
  await P.waitForTimeout(500);
  await shot(P, '15-ship-finished');
  await P.getByRole('button', { name: '再來一局' }).click();
  await P.getByText('第 2 局').waitFor();
  await P.getByText('電腦（普通）已經擺好了').waitFor();

  // ---------- 幾A幾B：跟電腦練習（桌機）----------
  step('幾A幾B 跟電腦練習：3 位數、不重複、普通');
  const Q = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  Q.on('pageerror', (e) => console.error('[Q pageerror]', e.message));
  await Q.goto(BASE);
  await Q.getByLabel('先取個暱稱').fill('小安');
  await Q.getByRole('button', { name: /開新房間/ }).click();
  await Q.getByRole('button', { name: '幾A幾B怎麼玩' }).click();
  await Q.getByRole('heading', { name: '幾A幾B怎麼玩' }).waitFor();
  await Q.waitForTimeout(300);
  await shot(Q, '16-ab-howto');
  await Q.getByRole('button', { name: '知道了' }).click();
  await Q.locator('.mode-big', { hasText: '幾A幾B' }).click();
  await Q.getByRole('heading', { name: '幾A幾B設定' }).waitFor();
  await Q.getByRole('radio', { name: '3 位' }).check();
  await Q.getByText('猜 3 位數，數字不重複，總共有 720 種可能的密碼。').waitFor();
  await Q.getByRole('radio', { name: /可以，例如/ }).check();
  await Q.getByText('總共有 1,000 種').waitFor();
  await Q.getByRole('radio', { name: /不可以/ }).check();
  await shot(Q, '17-ab-setup');
  await Q.getByRole('button', { name: '跟電腦練習' }).click();

  step('設密碼：重複的數字會被擋下');
  await Q.getByRole('heading', { name: '設定你的密碼' }).waitFor();
  await Q.getByText('電腦（普通）已經設好密碼了').waitFor();
  await Q.getByLabel(/你的密碼/).fill('112');
  await Q.getByText('這一局數字不能重複').waitFor();
  if (!(await Q.getByRole('button', { name: '就用這組密碼' }).isDisabled())) throw new Error('重複數字不能送出');
  await Q.getByLabel(/你的密碼/).fill('123');
  await Q.getByRole('button', { name: '就用這組密碼' }).click();
  await Q.locator('.code-battle').waitFor();
  const qcode = Q.url().split('#/p/')[1];
  const botSecret = await Q.evaluate((id) => JSON.parse(sessionStorage.getItem(`planehunt.practice.${id}`)).rec.priv.p_bot.secret, qcode);

  const qTurn = () => Q.locator('.banner--mine').count();
  const qOver = () => Q.locator('.banner--win, .banner--lose').count();
  const qWait = async () => {
    for (let i = 0; i < 60 && !(await qTurn()) && !(await qOver()); i++) await Q.waitForTimeout(100);
  };
  const guessOnce = async (code) => {
    const before = await Q.locator('.code-main .guess-table li').count();
    await Q.getByLabel(/猜一組/).fill(code);
    await Q.getByRole('button', { name: '猜', exact: true }).click();
    await Q.waitForFunction((n) => document.querySelectorAll('.code-main .guess-table li').length > n, before);
  };

  step('跟電腦聊天：說「我會贏喔！」，電腦大多會回話');
  await Q.getByRole('button', { name: /^聊天/ }).click();
  let botTalked = false;
  for (let i = 0; i < 4 && !botTalked; i++) {
    await Q.getByRole('button', { name: i % 2 ? '哈哈哈' : '我會贏喔！' }).click();
    try {
      await Q.locator('.chat-msg:not(.chat-msg--mine)').first().waitFor({ timeout: 3000 });
      botTalked = true;
    } catch {
      // 電腦偶爾已讀不回，再說一次
    }
  }
  if (!botTalked) throw new Error('電腦都沒有回話');
  await shot(Q, '17b-chat-bot');
  await Q.getByRole('button', { name: '關閉聊天' }).click();

  step('先猜一組錯的，等電腦回猜，做數字筆記，再重新整理');
  await qWait();
  let wrong = '012';
  if (wrong === botSecret) wrong = '345';
  await guessOnce(wrong);
  await Q.locator('.code-main .guess-ab').first().waitFor();
  await Q.locator('.code-side .guess-table li').first().waitFor({ timeout: 5000 });
  await Q.getByRole('button', { name: '數字 9' }).click();
  await Q.getByRole('button', { name: '數字 9：確定沒有' }).click();
  await Q.getByRole('button', { name: '數字 9：確定有' }).waitFor();
  await shot(Q, '18-ab-battle');
  await Q.reload();
  await Q.locator('.code-battle').waitFor();
  await Q.getByRole('button', { name: '數字 9：確定有' }).waitFor(); // 筆記留著

  step('猜中電腦的密碼（或被電腦先猜中）');
  await qWait();
  if (!(await qOver())) await guessOnce(botSecret);
  await Q.locator('.banner--win, .banner--lose').waitFor({ timeout: 10000 });
  await Q.locator('dialog.result[open]').waitFor();
  await Q.getByRole('dialog').getByText('電腦（普通）的密碼是').waitFor();
  await Q.waitForTimeout(500);
  await shot(Q, '19-ab-finished');

  step('關掉勝負彈窗 → 重新整理不會再跳 → 按「看結果」可以再打開');
  await Q.getByRole('button', { name: '看紀錄' }).click();
  await Q.reload();
  await Q.locator('.code-battle').waitFor();
  await Q.waitForTimeout(300);
  if (await Q.locator('dialog.result[open]').count()) throw new Error('關掉的勝負彈窗不該再自動跳出');
  await Q.getByRole('button', { name: '看結果' }).click();
  await Q.locator('dialog.result[open]').waitFor();
  await Q.getByRole('button', { name: '再來一局' }).click();
  await Q.getByRole('heading', { name: '設定你的密碼' }).waitFor();
  await Q.getByText('第 2 局').waitFor();

  // ---------- 對戰紀錄與登入 ----------
  step('對戰紀錄：訪客看得到剛剛的練習紀錄');
  await Q.getByRole('link', { name: '對戰紀錄' }).click();
  await Q.getByRole('heading', { name: '對戰紀錄' }).waitFor();
  await Q.getByRole('heading', { name: '你現在是訪客' }).waitFor();
  await Q.locator('.history-item', { hasText: '幾A幾B' }).first().waitFor();
  await Q.locator('.history-item', { hasText: '練習（普通）' }).first().waitFor();
  if ((await Q.locator('.history-item').count()) !== 1) throw new Error('練習紀錄應該剛好一筆');
  await shot(Q, '20-history-guest');

  step('用（模擬的）Google 登入：身分不變，紀錄還在');
  await Q.getByRole('button', { name: '用 Google 登入' }).click();
  await Q.getByText(/tester[0-9a-f]*@example\.com/).waitFor();
  await Q.getByRole('link', { name: '我的帳號' }).waitFor();
  await Q.locator('.history-item').first().waitFor();
  await Q.reload();
  await Q.getByText(/tester[0-9a-f]*@example\.com/).waitFor();
  await Q.locator('.history-item').first().waitFor();
  await shot(Q, '21-history-signed-in');

  step('登出：變回新的訪客，看不到帳號的紀錄');
  await Q.getByRole('button', { name: '登出' }).click();
  await Q.getByRole('heading', { name: '你現在是訪客' }).waitFor();
  await Q.getByText('還沒有紀錄').waitFor();

  step('線上對戰：A 的紀錄有兩局都贏（一局找齊機頭、一局對手離開）');
  await A.goto(`${BASE}#/history`);
  await A.getByRole('heading', { name: '對戰紀錄' }).waitFor();
  await A.locator('.history-item--win', { hasText: '對 小華' }).nth(1).waitFor();
  await A.getByText('對手中途離開').waitFor();
  await shot(A, '22-history-online');

  // ---------- 排行榜與獎牌 ----------
  step('排行榜：訪客 A 看得到登入提示，獎牌收藏裡已經有「初登場勝利」');
  await A.getByRole('link', { name: '排行榜' }).click();
  await A.getByRole('heading', { name: '排行榜' }).waitFor();
  await A.getByRole('heading', { name: '登入 Google 才會上榜' }).waitFor();
  await A.locator('.medal-card.is-earned', { hasText: '初登場勝利' }).waitFor();
  await A.getByText(/已獲得 \d+ \/ 25/).waitFor();

  step('排行榜：幾位（模擬的）Google 玩家互相打幾A幾B，名字用 Gmail 前綴');
  const G = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  G.on('pageerror', (e) => console.error('[G pageerror]', e.message));
  await G.goto(`${BASE}#/history`);
  await G.getByRole('button', { name: '用 Google 登入' }).click();
  await G.getByRole('link', { name: '我的帳號' }).waitFor();
  const gToken = await G.evaluate(() => {
    const acct = JSON.parse(localStorage.getItem('planehunt.localAccount'));
    return { token: `${acct.token}|${acct.email}`, prefix: acct.email.split('@')[0] };
  });
  const api = (token) => async (action, body = {}) => {
    const r = await fetch(`${BASE}api/${action}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(`${action}: ${j.error?.message ?? r.status}`);
    return j;
  };
  const rnd = () => Math.random().toString(16).slice(2, 10);
  const me = api(gToken.token);
  const rivals = ['captain.lee', 'meimei0912', 'xiaoming.chen'].map((n) => ({ n, call: api(`e2e-${n.replace(/\./g, "_")}-${rnd()}${rnd()}|${n}@gmail.com`) }));
  /** 一局幾A幾B：贏的人直接猜中對方的密碼 */
  const abGame = async (host, guest, hostWins) => {
    const { game } = await host('create', { name: '主', settings: { mode: 'ab', digits: 3 } });
    await guest('join', { gameId: game.id, name: '客' });
    await host('secret', { gameId: game.id, secret: '123' });
    const started = await guest('secret', { gameId: game.id, secret: '456' });
    const hostFirst = started.game.turn === started.game.hostId;
    if (hostWins !== hostFirst) await (hostWins ? guest : host)('guess', { gameId: game.id, guess: '789' });
    await (hostWins ? host : guest)('guess', { gameId: game.id, guess: hostWins ? '456' : '123' });
  };
  // 我：對三個人各打，5 勝 1 敗（連贏 5 場幾A幾B → 密碼破譯大師）
  for (const [i, win] of [false, true, true, true, true, true].entries()) await abGame(me, rivals[i % 3].call, win);
  await abGame(rivals[0].call, rivals[1].call, true);
  await abGame(rivals[0].call, rivals[2].call, true);
  await abGame(rivals[1].call, rivals[2].call, false);

  await G.getByRole('link', { name: '排行榜' }).click();
  await G.locator('.lb-row.is-me', { hasText: gToken.prefix }).waitFor();
  await G.locator('.lb-row', { hasText: 'captain.lee' }).waitFor();
  await G.locator('.lb-row.is-me .lb-rate', { hasText: '83' }).waitFor();
  await G.locator('.lb-row.is-me').getByRole('button', { name: /密碼破譯大師/ }).waitFor();
  await G.locator('.lb-row.is-me').getByRole('button', { name: /密碼破譯大師/ }).click();
  await G.locator('.toast', { hasText: '幾A幾B 跟真人連贏 5 場' }).waitFor();
  if (await G.locator('.lb-row', { hasText: '測試' }).count()) throw new Error('不該出現暱稱，要用 Gmail 前綴');
  await G.locator('.medal-card.is-earned', { hasText: '好人緣' }).count();
  await shot(G, '23-leaderboard');
  await G.getByRole('button', { name: '飛機版' }).click();
  await G.getByText('飛機版還沒有人上榜').waitFor();
  await G.getByRole('button', { name: '幾A幾B' }).click();
  await G.locator('.lb-row.is-me').waitFor();
  await G.setViewportSize({ width: 390, height: 844 });
  await G.getByRole('button', { name: '全部' }).click();
  await G.waitForTimeout(200);
  await shot(G, '24-leaderboard-mobile');
  const overflow = await G.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) throw new Error(`手機版排行榜橫向溢出 ${overflow}px`);

  step('提示訊息會自動消失');
  await A.waitForTimeout(4600);
  if (await A.locator('.toast').count()) throw new Error('toast 沒有自動消失');

  console.log('\n✓ E2E 全部通過');
} catch (e) {
  console.error('\n✗ E2E 失敗：', e.message);
  let i = 0;
  for (const ctx of browser.contexts()) for (const pg of ctx.pages()) await shot(pg, `fail-${i++}`).catch(() => {});
  process.exitCode = 1;
} finally {
  await browser.close();
}
