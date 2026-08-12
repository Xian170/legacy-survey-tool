/*
 * legacy-survey-tool 最小驗證
 * ---------------------------------------------------------------
 * 本工具是單檔 HTML，邏輯全內嵌於 <script>。此測試不裝任何套件，
 * 做法：抽出 <script>，以「最小假 DOM」在 Node 載入，再對純邏輯
 * 函式（normalize、進度計算、filled、moveNode、buildMarkdown 等）
 * 做斷言比對。視覺與互動手感仍須在真實瀏覽器驗收。
 *
 * 執行：node tests/test.cjs   （於工具資料夾內）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

/* ---- 最小假 DOM：只求 top-level 載入不拋錯 ---- */
function makeEl() {
  return {
    innerHTML: '', textContent: '', value: '', onclick: null, onchange: null, className: '',
    style: {}, dataset: {}, files: [],
    addEventListener() {}, removeEventListener() {},
    querySelector() { return makeEl(); }, querySelectorAll() { return []; },
    appendChild() {}, removeChild() {}, remove() {},
    setAttribute() {}, getAttribute() { return null; },
    focus() {}, select() {}, click() {}, closest() { return null; },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    getBoundingClientRect() { return { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0 }; },
  };
}

/* ---- 載入 HTML 內嵌 script，回傳可測的邏輯函式 ---- */
function loadApi() {
  const htmlPath = path.join(__dirname, '..', 'legacy-survey-tool.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('找不到 <script> 區塊');

  // 在同一作用域尾端掛出要測的識別字（STATE 用 getter/setter 取活繫結）
  const tail = `
;globalThis.__api = {
  get STATE(){ return STATE; }, set STATE(v){ STATE = v; },
  normalize, nodeProgress, compProgress, allProgress, buildMarkdown,
  moveNode, findNode, pathOf, menuPathStr, filled, allNodes, makeNode,
  nameCmp, sanitizeName, extFromDataUrl, siblingFolderNames, bundleImages,
  crc32, zipStore, baseName,
  COMPONENT_TYPES, SCREEN_FIELDS
};`;

  const document = {
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    createElement() { return makeEl(); },
    addEventListener() {}, removeEventListener() {},
    execCommand() { return true; },
    body: makeEl(),
  };
  const sandbox = {
    document,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    navigator: {},
    console,
    setTimeout() { return 0; }, clearTimeout() {},
    TextEncoder, atob,
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(m[1] + tail, sandbox, { filename: 'legacy-survey-tool.script.js' });
  return sandbox.__api;
}

/* ---- 極簡測試框架 ---- */
const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const val = (f) => (f.type === 'multi' || f.type === 'images') ? ['x'] : 'x';
const freshState = (api, tree) => { api.STATE = { meta: { client: '', date: '', note: '' }, tree, selected: null, treeHidden: false }; };

const api = loadApi();

/* 1. normalize：舊平面 screens → 頂層節點 */
test('normalize 舊平面 screens 轉頂層節點', () => {
  const r = api.normalize({ screens: [{ name: '登入頁', fields: { x: '高' } }] });
  assert.strictEqual(r.tree.length, 1);
  assert.strictEqual(r.tree[0].name, '登入頁');
  assert.strictEqual(r.selected, r.tree[0].id);
  assert.ok(Array.isArray(r.tree[0].children));
});

/* 2. normalize：過濾未知元件類型 */
test('normalize 過濾未知元件類型', () => {
  const r = api.normalize({ tree: [{ name: 'A', components: [{ type: '不存在' }, { type: '按鈕與動作' }] }] });
  assert.strictEqual(r.tree[0].components.length, 1);
  assert.strictEqual(r.tree[0].components[0].type, '按鈕與動作');
});

/* 3. filled：各型態判定 */
test('filled 各型態判定正確', () => {
  assert.strictEqual(api.filled('text', '   '), false);
  assert.strictEqual(api.filled('text', 'x'), true);
  assert.strictEqual(api.filled('req', '是'), true);
  assert.strictEqual(api.filled('req', ''), false);
  assert.strictEqual(api.filled('multi', ['num']), true);
  assert.strictEqual(api.filled('multi', []), false);
});

/* 4. nodeProgress：空節點 total=畫面欄位數、填一欄 done=1 */
test('nodeProgress 計數', () => {
  const n = api.makeNode('X');
  const p0 = api.nodeProgress(n);
  assert.strictEqual(p0.done, 0);
  assert.strictEqual(p0.total, api.SCREEN_FIELDS.length);
  const f = api.SCREEN_FIELDS[0];
  n.fields[f.key] = val(f);
  assert.strictEqual(api.nodeProgress(n).done, 1);
});

/* 5. compProgress：元件欄位計數 */
test('compProgress 計數', () => {
  const type = '按鈕與動作';
  const c = { type, fields: {} };
  assert.strictEqual(api.compProgress(c).done, 0);
  assert.strictEqual(api.compProgress(c).total, api.COMPONENT_TYPES[type].fields.length);
  c.fields[api.COMPONENT_TYPES[type].fields[0].key] = '是';
  assert.strictEqual(api.compProgress(c).done, 1);
});

/* 6. moveNode：搬成子節點，且擋掉拖入自己的子孫 */
test('moveNode 成為子節點並擋子孫', () => {
  const A = api.makeNode('A'), B = api.makeNode('B');
  freshState(api, [A, B]);
  api.moveNode(B.id, A.id, 'into');
  assert.strictEqual(api.STATE.tree.length, 1);
  assert.strictEqual(api.STATE.tree[0].children[0].id, B.id);
  // A 不可拖入其子孫 B
  api.moveNode(A.id, B.id, 'into');
  assert.strictEqual(api.STATE.tree.length, 1);
  assert.strictEqual(api.STATE.tree[0].id, A.id);
});

/* 7. moveNode：before 排序 */
test('moveNode before 改變順序', () => {
  const A = api.makeNode('A'), B = api.makeNode('B'), C = api.makeNode('C');
  freshState(api, [A, B, C]);
  api.moveNode(C.id, A.id, 'before');
  assert.deepStrictEqual(api.STATE.tree.map(n => n.name), ['C', 'A', 'B']);
});

/* 8. menuPathStr：巢狀路徑串接 */
test('menuPathStr 巢狀路徑', () => {
  const parent = api.makeNode('父');
  freshState(api, [parent]);
  const child = api.makeNode('子');
  parent.children.push(child);
  assert.strictEqual(api.menuPathStr(child.id), '父 > 子');
});

/* 9. buildMarkdown：含標題、客戶、架構圖與選單路徑 */
test('buildMarkdown 輸出重點欄位', () => {
  const node = api.makeNode('查詢頁');
  freshState(api, [node]);
  api.STATE.meta.client = '某銀行';
  api.STATE.meta.date = '2026-08-11';
  node.fields[api.SCREEN_FIELDS[0].key] = val(api.SCREEN_FIELDS[0]);
  const md = api.buildMarkdown();
  assert.ok(md.includes('# 舊系統功能現勘紀錄'));
  assert.ok(md.includes('某銀行'));
  assert.ok(md.includes('## 頁面／功能架構'));
  assert.ok(md.includes('查詢頁'));
  assert.ok(md.includes('選單路徑：查詢頁'));
});

/* 10. 每個元件都有「是否必填」（req 型態）；自訂備註除外 */
test('元件是否必填欄位齊備', () => {
  const CT = api.COMPONENT_TYPES;
  const hasReq = (t) => CT[t].fields.some(f => f.label === '是否必填' && f.type === 'req');
  const hasReqOrSel = (t) => CT[t].fields.some(f => (f.label === '是否必填' || f.label === '是否必選') && f.type === 'req');
  ['查詢邏輯', '結果清單', '報表匯出', '錯誤與提示'].forEach(t => assert.ok(hasReq(t), t + ' 缺是否必填'));
  Object.keys(CT).filter(t => t !== '自訂備註').forEach(t => assert.ok(hasReqOrSel(t), t + ' 缺是否必填／必選'));
  assert.ok(!CT['自訂備註'].fields.some(f => f.label === '是否必填'), '自訂備註不應有是否必填');
  // 錯誤與提示：新的是否必填用 required key，原 req（必填未填的提示）仍在
  const em = CT['錯誤與提示'].fields;
  assert.ok(em.some(f => f.key === 'required' && f.type === 'req'));
  assert.ok(em.some(f => f.key === 'req' && f.type === 'textarea'));
});

/* 11. 是否必填／必選一律排在各元件第一個欄位（自訂備註除外） */
test('是否必填欄位置於首位', () => {
  const CT = api.COMPONENT_TYPES;
  Object.keys(CT).filter(t => t !== '自訂備註').forEach(t => {
    const first = CT[t].fields[0];
    assert.ok(first.type === 'req' && (first.label === '是否必填' || first.label === '是否必選'),
      t + ' 第一欄不是是否必填／必選');
  });
});

/* 12. 字體設定：Google 連線來源 + 本機 local 備援 + 字型堆疊 */
test('字體連線／離線備援設定齊全', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'legacy-survey-tool.html'), 'utf8');
  // 連線來源：Google Fonts 的 Noto Sans TC（含 100..900 字重）
  assert.ok(/fonts\.googleapis\.com\/css2\?family=Noto\+Sans\+TC:wght@100\.\.900/.test(html), '缺 Google Fonts 連結');
  // 離線本機來源：local() 指向本機 Noto Sans TC
  assert.ok(/@font-face[\s\S]*?local\("Noto Sans TC"\)/.test(html), '缺 local() 本機字體來源');
  // 字型堆疊：本機優先 → web → 微軟正黑體
  assert.ok(/--sans:"Noto Sans TC Local","Noto Sans TC","Microsoft JhengHei"/.test(html), '--sans 堆疊順序不符');
});

/* 13. nameCmp：依名稱自然排序 */
test('nameCmp 自然排序', () => {
  const arr = [{ name: 'image10.png' }, { name: 'image2.png' }, { name: 'image1.png' }];
  arr.sort(api.nameCmp);
  assert.deepStrictEqual(arr.map(x => x.name), ['image1.png', 'image2.png', 'image10.png']);
});

/* 14. sanitizeName：清掉非法字元 */
test('sanitizeName 清非法字元', () => {
  assert.strictEqual(api.sanitizeName('a/b:c*?'), 'a_b_c__');
});

/* 15. bundleImages：路徑對映樹狀階層並去重 */
test('bundleImages 路徑對映與去重', () => {
  const parent = api.makeNode('查詢');
  const child = api.makeNode('明細');
  parent.children.push(child);
  freshState(api, [parent]);
  parent.fields.shots = [{ id: 'p1', name: '總覽.png', data: 'data:image/png;base64,AAAA' }];
  child.fields.shots = [
    { id: 'c1', name: 'list.jpg', data: 'data:image/jpeg;base64,AAAA' },
    { id: 'c2', name: 'list.jpg', data: 'data:image/jpeg;base64,BBBB' },
  ];
  const { files, pathById } = api.bundleImages();
  assert.strictEqual(files.length, 3);
  assert.strictEqual(pathById['p1'], 'screens/查詢/總覽.png');
  assert.strictEqual(pathById['c1'], 'screens/查詢/明細/list.jpg');
  assert.strictEqual(pathById['c2'], 'screens/查詢/明細/list_2.jpg');
});

/* 16. buildMarkdown：帶 pathById 時輸出圖片連結；純文字版不含路徑 */
test('buildMarkdown 圖片路徑切換', () => {
  const node = api.makeNode('登入');
  freshState(api, [node]);
  node.fields.shots = [{ id: 's1', name: '畫面.jpg', data: 'data:image/jpeg;base64,AAAA' }];
  const { pathById } = api.bundleImages();
  const withImg = api.buildMarkdown(pathById);
  assert.ok(withImg.includes('![畫面.jpg](screens/登入/畫面.jpg)'), '打包版缺圖片連結');
  const plain = api.buildMarkdown();
  assert.ok(!plain.includes('screens/'), '純文字版不應含路徑');
  assert.ok(plain.includes('張'), '純文字版應為張數描述');
});

/* 17. crc32：已知值 */
test('crc32 已知值', () => {
  assert.strictEqual(api.crc32(Buffer.from('123456789', 'utf8')), 0xCBF43926);
});

/* 18. zipStore：輸出以 PK 開頭 */
test('zipStore 產生合法 zip 標頭', () => {
  const z = api.zipStore([{ path: 'a.txt', bytes: new TextEncoder().encode('hi') }]);
  assert.strictEqual(z[0], 0x50); // 'P'
  assert.strictEqual(z[1], 0x4B); // 'K'
});

/* 19. baseName：<客戶>_<功能名稱>現勘紀錄_<拜訪日期> */
test('baseName 檔名格式', () => {
  freshState(api, []);
  api.STATE.meta.client = '某銀行';
  api.STATE.meta.note = '授信查詢';
  api.STATE.meta.date = '2026-08-01';
  assert.strictEqual(api.baseName(), '某銀行_授信查詢現勘紀錄_2026-08-01');
  // 客戶留白時以「客戶」代替
  api.STATE.meta.client = '';
  assert.strictEqual(api.baseName(), '客戶_授信查詢現勘紀錄_2026-08-01');
  // 拜訪日期未填時退用當天
  api.STATE.meta.client = '某銀行';
  api.STATE.meta.date = '';
  assert.strictEqual(api.baseName(), '某銀行_授信查詢現勘紀錄_' + new Date().toISOString().slice(0, 10));
});

/* ---- 執行 ---- */
let pass = 0, fail = 0;
console.log('legacy-survey-tool 最小驗證\n');
for (const [name, fn] of tests) {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.error('  ✗ ' + name + '\n     ' + (e && e.message)); fail++; }
}
console.log(`\n結果：${pass} 通過、${fail} 失敗`);
process.exit(fail ? 1 : 0);
