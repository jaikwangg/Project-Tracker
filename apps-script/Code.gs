/**
 * Project Tracker — Google Apps Script backend
 *
 * Script Properties:
 *   PIN_HASH     (บังคับ) SHA-256 hex ของ (PIN + PIN_SALT) — สร้างด้วย setPin()
 *   PIN_SALT     (บังคับ) สตริงสุ่ม — สร้างด้วย setPin()
 *   GITHUB_TOKEN (บังคับ) Fine-grained PAT สำหรับอ่าน private repo
 *   sess_<token>          session ที่ login อยู่ (ค่า = เวลาหมดอายุ ms)
 *   pin_lock_until / pin_lock_rounds  สถานะการล็อก PIN
 */

// ---------------------------------------------------------------------------
// ฟังก์ชันสำหรับรันจาก Apps Script editor
// ---------------------------------------------------------------------------

/**
 * ตั้ง/เปลี่ยน PIN: ใส่ PIN 6 หลักใน NEW_PIN → Run → แล้วลบค่าออกทันที (อย่า Save ค่า PIN ทิ้งไว้)
 * การเปลี่ยน PIN จะเตะทุกเครื่องออกด้วย
 */
function setPin() {
  var NEW_PIN = ''; // ← ใส่ PIN ชั่วคราวตรงนี้ แล้วลบออกหลังรันเสร็จ
  if (!/^\d{6}$/.test(NEW_PIN)) throw new Error('PIN ต้องเป็นตัวเลข 6 หลัก');
  var salt = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  var props = PropertiesService.getScriptProperties();
  props.setProperties({ PIN_SALT: salt, PIN_HASH: sha256Hex_(NEW_PIN + salt) });
  props.deleteProperty('pin_lock_until');
  props.deleteProperty('pin_lock_rounds');
  CacheService.getScriptCache().remove('pin_fail');
  var n = revokeAllSessions();
  Logger.log('ตั้ง PIN เรียบร้อย — ล้าง session เดิม ' + n + ' รายการ อย่าลืมลบ PIN ออกจากโค้ด');
}

/** เตะทุกเครื่องออก (เช่น ทำเครื่องหาย) */
function revokeAllSessions() {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys().filter(function (k) { return k.indexOf(SESSION_PREFIX) === 0; });
  keys.forEach(function (k) { props.deleteProperty(k); });
  Logger.log('ล้าง session ' + keys.length + ' รายการ');
  return keys.length;
}

/** ตรวจการดึง commit: รันจาก editor แล้วดู Execution log ว่าแต่ละ repo ได้ผลอะไร */
function testGithub() {
  var gh = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!gh) { Logger.log('✗ ยังไม่มี Script Property ชื่อ GITHUB_TOKEN (ตัวพิมพ์ใหญ่ทั้งหมด)'); return; }
  Logger.log('GITHUB_TOKEN: มีค่า (ยาว ' + gh.length + ' ตัว, ขึ้นต้น ' + gh.slice(0, 11) + '…)');

  var auth = UrlFetchApp.fetch('https://api.github.com/rate_limit', githubRequest_('x/x', '', gh.trim()));
  Logger.log(auth.getResponseCode() === 200
    ? '✓ token ใช้ได้ (rate limit เหลือ ' + JSON.parse(auth.getContentText()).rate.remaining + ')'
    : '✗ token ใช้ไม่ได้: HTTP ' + auth.getResponseCode() + ' ' + auth.getContentText().slice(0, 200));

  var projects = readObjects_('Projects').filter(function (p) { return p.repo; });
  if (!projects.length) { Logger.log('✗ ยังไม่มีโปรเจคไหนใส่ repo — กด "แก้ไขโปรเจค" แล้วใส่ owner/repo'); return; }
  projects.forEach(function (p) {
    if (!REPO_RE.test(p.repo)) { Logger.log('✗ ' + p.name + ': repo "' + p.repo + '" รูปแบบไม่ถูก (ต้องเป็น owner/repo)'); return; }
    var req = githubRequest_(p.repo, p.branch, gh.trim());
    var res = UrlFetchApp.fetch(req.url, req);
    var code = res.getResponseCode();
    var c = parseCommit_(res);
    Logger.log((c ? '✓ ' : '✗ ') + p.name + ' (' + p.repo + (p.branch ? '@' + p.branch : '') + '): HTTP ' + code +
      (c ? ' — ' + c.message.slice(0, 60) : ' — ' + res.getContentText().slice(0, 150)));
  });
  Logger.log('หมายเหตุ: ผลในเว็บ cache ไว้ 2–10 นาที แก้แล้วรอสักครู่หรือกด ⟳');
}

var SESSION_PREFIX = 'sess_';
var DAY_MS = 24 * 60 * 60 * 1000;
var SESSION_TTL_MS = 30 * DAY_MS;
var SESSION_RENEW_BELOW_MS = 7 * DAY_MS;
var MAX_PIN_FAILS = 5;
var LOCK_SHORT_MS = 15 * 60 * 1000;
var LOCK_LONG_MS = DAY_MS;
var LOCK_ROUNDS_FOR_LONG = 3;

var BACKEND_VERSION = '2026-10-01.3';

var SCHEMA = {
  Projects: {
    headers: ['id', 'name', 'dueDate', 'note', 'repo', 'branch', 'order', 'createdAt', 'updatedAt'],
    text: ['id', 'name', 'dueDate', 'note', 'repo', 'branch', 'createdAt', 'updatedAt'],
  },
  Items: {
    headers: ['id', 'projectId', 'text', 'done', 'order', 'createdAt', 'updatedAt'],
    text: ['id', 'projectId', 'text', 'createdAt', 'updatedAt'],
  },
};

var LIMITS = { name: 100, text: 300, note: 1000, branch: 100 };
var REPO_RE = /^[\w.-]+\/[\w.-]+$/;
var BRANCH_RE = /^[\w./-]+$/;
var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
var COMMIT_CACHE_SECONDS = 600;
var COMMIT_ERROR_CACHE_SECONDS = 120;

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

function doGet(e) {
  return respond_(function () {
    var p = (e && e.parameter) || {};
    checkSession_(p.sessionToken);
    switch (p.action) {
      case 'list':
        return { projects: readObjects_('Projects'), items: readObjects_('Items'), version: BACKEND_VERSION };
      case 'commits':
        return { commits: getCommits_() };
      default:
        throw new Error('ไม่รู้จัก action: ' + p.action);
    }
  });
}

function doPost(e) {
  return respond_(function () {
    var body;
    try {
      body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    } catch (err) {
      throw new Error('รูปแบบข้อมูลไม่ถูกต้อง (ต้องเป็น JSON)');
    }
    var data = body.data || {};
    if (body.action === 'login') return { data: withLock_(function () { return login_(data); }) };
    if (body.action === 'logout') return { data: logout_(body.sessionToken) };

    checkSession_(body.sessionToken);
    var handler = POST_ACTIONS[body.action];
    if (!handler) throw new Error('ไม่รู้จัก action: ' + body.action);
    return { data: withLock_(function () { return handler(data); }) };
  });
}

var POST_ACTIONS = {
  addProject: addProject_,
  updateProject: updateProject_,
  deleteProject: deleteProject_,
  reorderProjects: reorderProjects_,
  addItem: addItem_,
  updateItem: updateItem_,
  deleteItem: deleteItem_,
  syncGithub: syncGithub_,
};

function respond_(fn) {
  var out;
  try {
    var result = fn();
    out = { ok: true };
    for (var k in result) out[k] = result[k];
  } catch (err) {
    out = { ok: false, error: (err && err.message) || String(err) };
    if (err && err.extra) for (var x in err.extra) out[x] = err.extra[x];
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/** Error ที่แนบ field เพิ่มใน response ได้ เช่น retryAfterSec */
function apiError_(message, extra) {
  var err = new Error(message);
  err.extra = extra;
  return err;
}

// ---------------------------------------------------------------------------
// Auth: PIN + session
// ---------------------------------------------------------------------------

function sha256Hex_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

/**
 * ตัวนับ PIN ผิดอยู่ใน CacheService (หายเองใน 6 ชม.)
 * สถานะล็อกอยู่ใน Script Properties เพราะ CacheService เก็บได้ไม่เกิน 6 ชม. แต่ล็อกยาวต้อง 24 ชม.
 */
function login_(data) {
  var props = PropertiesService.getScriptProperties();
  var cache = CacheService.getScriptCache();
  var hash = props.getProperty('PIN_HASH');
  var salt = props.getProperty('PIN_SALT');
  if (!hash || !salt) throw new Error('ยังไม่ได้ตั้ง PIN — รัน setPin() จาก Apps Script editor');

  var now = Date.now();
  var lockUntil = Number(props.getProperty('pin_lock_until')) || 0;
  if (lockUntil > now) throw apiError_('locked', { retryAfterSec: Math.ceil((lockUntil - now) / 1000) });

  var pin = data.pin == null ? '' : String(data.pin);
  if (/^\d{6}$/.test(pin) && safeEqual_(sha256Hex_(pin + salt), hash)) {
    cache.remove('pin_fail');
    props.deleteProperty('pin_lock_until');
    props.deleteProperty('pin_lock_rounds');
    purgeExpiredSessions_(props, now);
    var token = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
    var expiresAt = now + SESSION_TTL_MS;
    props.setProperty(SESSION_PREFIX + token, String(expiresAt));
    return { sessionToken: token, expiresAt: new Date(expiresAt).toISOString() };
  }

  var fails = (Number(cache.get('pin_fail')) || 0) + 1;
  if (fails < MAX_PIN_FAILS) {
    cache.put('pin_fail', String(fails), 21600);
    throw apiError_('invalid_pin', { remaining: MAX_PIN_FAILS - fails });
  }
  // ผิดครบ → ล็อก
  cache.remove('pin_fail');
  var rounds = (Number(props.getProperty('pin_lock_rounds')) || 0) + 1;
  var lockMs = LOCK_SHORT_MS;
  if (rounds >= LOCK_ROUNDS_FOR_LONG) {
    lockMs = LOCK_LONG_MS;
    rounds = 0;
  }
  props.setProperties({ pin_lock_until: String(now + lockMs), pin_lock_rounds: String(rounds) });
  throw apiError_('locked', { retryAfterSec: Math.ceil(lockMs / 1000) });
}

function logout_(token) {
  if (typeof token === 'string' && token) {
    PropertiesService.getScriptProperties().deleteProperty(SESSION_PREFIX + token);
  }
  return { loggedOut: true };
}

/** ตรวจ session + ต่ออายุอัตโนมัติเมื่อเหลือน้อยกว่า 7 วัน */
function checkSession_(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) throw new Error('unauthorized');
  var props = PropertiesService.getScriptProperties();
  var key = SESSION_PREFIX + token;
  var expiry = Number(props.getProperty(key)) || 0;
  var now = Date.now();
  if (expiry <= now) {
    if (expiry) props.deleteProperty(key);
    throw new Error('unauthorized');
  }
  if (expiry - now < SESSION_RENEW_BELOW_MS) props.setProperty(key, String(now + SESSION_TTL_MS));
}

function purgeExpiredSessions_(props, now) {
  var all = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(SESSION_PREFIX) === 0 && !(Number(all[k]) > now)) props.deleteProperty(k);
  });
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (err) {
    throw new Error('ระบบกำลังบันทึกข้อมูลอื่นอยู่ ลองใหม่อีกครั้ง');
  }
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------------------
// Sheet helpers — read whole sheet once, work in memory
// ---------------------------------------------------------------------------

function getSheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var schema = SCHEMA[name];
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, schema.headers.length).setValues([schema.headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
    // คอลัมน์ข้อความเป็น plain text เพื่อไม่ให้ Sheets แปลง dueDate เป็น Date
    schema.text.forEach(function (col) {
      var c = schema.headers.indexOf(col) + 1;
      sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  }
  return sh;
}

/** อ่านทั้งแผ่นครั้งเดียว คืน { sh, headers, col, rows } (rows ไม่รวม header) */
function table_(name) {
  var sh = getSheet_(name);
  var values = sh.getDataRange().getValues();
  var headers = values[0].map(String);
  var col = {};
  headers.forEach(function (h, i) { col[h] = i; });
  SCHEMA[name].headers.forEach(function (h) {
    if (!(h in col)) throw new Error('แผ่น ' + name + ' ไม่มีคอลัมน์ ' + h);
  });
  return { name: name, sh: sh, headers: headers, col: col, rows: values.slice(1) };
}

function normValue_(key, v) {
  if (key === 'done') return v === true || String(v).toUpperCase() === 'TRUE';
  if (key === 'order') return Number(v) || 0;
  if (v instanceof Date) {
    return key === 'dueDate'
      ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : v.toISOString();
  }
  return v == null ? '' : String(v);
}

function toObj_(t, row) {
  var o = {};
  SCHEMA[t.name].headers.forEach(function (h) { o[h] = normValue_(h, row[t.col[h]]); });
  return o;
}

function toRow_(t, obj) {
  return t.headers.map(function (h) { return h in obj ? obj[h] : ''; });
}

function readObjects_(name) {
  var t = table_(name);
  return t.rows
    .filter(function (r) { return r[t.col.id] !== ''; })
    .map(function (r) { return toObj_(t, r); });
}

function findIndex_(t, id) {
  for (var i = 0; i < t.rows.length; i++) if (String(t.rows[i][t.col.id]) === String(id)) return i;
  return -1;
}

/** เขียนแถว (index 0-based ใน t.rows) พร้อมบังคับ format ข้อความ */
function writeRows_(t, startIndex, rows) {
  if (!rows.length) return;
  var r = startIndex + 2;
  SCHEMA[t.name].text.forEach(function (h) {
    t.sh.getRange(r, t.col[h] + 1, rows.length, 1).setNumberFormat('@');
  });
  t.sh.getRange(r, 1, rows.length, t.headers.length).setValues(rows);
}

function appendRows_(t, objs) {
  var rows = objs.map(function (o) { return toRow_(t, o); });
  writeRows_(t, t.sh.getLastRow() - 1, rows);
}

/** ลบแถวจากล่างขึ้นบน รวมแถวที่ติดกันเป็นก้อนเดียว */
function deleteRowIndexes_(t, indexes) {
  var rowsDesc = indexes.map(function (i) { return i + 2; }).sort(function (a, b) { return b - a; });
  var k = 0;
  while (k < rowsDesc.length) {
    var end = rowsDesc[k];
    var start = end;
    while (k + 1 < rowsDesc.length && rowsDesc[k + 1] === start - 1) { start--; k++; }
    t.sh.deleteRows(start, end - start + 1);
    k++;
  }
}

function maxOrder_(t, filterFn) {
  var max = -1;
  t.rows.forEach(function (r) {
    if (r[t.col.id] === '' || (filterFn && !filterFn(r))) return;
    max = Math.max(max, Number(r[t.col.order]) || 0);
  });
  return max;
}

function now_() { return new Date().toISOString(); }

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function cleanStr_(v, field, max, required) {
  var s = v == null ? '' : String(v).trim();
  if (required && !s) throw new Error(field + ' ห้ามว่าง');
  if (s.length > max) throw new Error(field + ' ยาวเกิน ' + max + ' ตัวอักษร');
  return s;
}

function cleanProjectFields_(data, isNew) {
  var out = {};
  if (isNew || 'name' in data) out.name = cleanStr_(data.name, 'ชื่อโปรเจค', LIMITS.name, true);
  if (isNew || 'note' in data) out.note = cleanStr_(data.note, 'โน้ต', LIMITS.note, false);
  if (isNew || 'dueDate' in data) {
    var d = cleanStr_(data.dueDate, 'วันกำหนด', 10, false);
    if (d && !DATE_RE.test(d)) throw new Error('วันกำหนดต้องเป็นรูปแบบ YYYY-MM-DD');
    out.dueDate = d;
  }
  if (isNew || 'repo' in data) {
    var repo = cleanStr_(data.repo, 'repo', 200, false);
    if (repo && !REPO_RE.test(repo)) throw new Error('repo ต้องอยู่ในรูปแบบ owner/repo');
    out.repo = repo;
  }
  if (isNew || 'branch' in data) {
    var branch = cleanStr_(data.branch, 'branch', LIMITS.branch, false);
    if (branch && !BRANCH_RE.test(branch)) throw new Error('ชื่อ branch ไม่ถูกต้อง');
    out.branch = branch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------

function addProject_(data) {
  var t = table_('Projects');
  var fields = cleanProjectFields_(data, true);
  var ts = now_();
  var p = {
    id: Utilities.getUuid(),
    name: fields.name,
    dueDate: fields.dueDate,
    note: fields.note,
    repo: fields.repo,
    branch: fields.branch,
    order: maxOrder_(t) + 1,
    createdAt: ts,
    updatedAt: ts,
  };
  appendRows_(t, [p]);
  return p;
}

function updateProject_(data) {
  var t = table_('Projects');
  var i = findIndex_(t, data.id);
  if (i < 0) throw new Error('ไม่พบโปรเจคนี้ (อาจถูกลบไปแล้ว)');
  var p = toObj_(t, t.rows[i]);
  var fields = cleanProjectFields_(data, false);
  for (var k in fields) p[k] = fields[k];
  if ('order' in data) p.order = Number(data.order) || 0;
  p.updatedAt = now_();
  writeRows_(t, i, [toRow_(t, p)]);
  return p;
}

function deleteProject_(data) {
  var pt = table_('Projects');
  var i = findIndex_(pt, data.id);
  if (i < 0) throw new Error('ไม่พบโปรเจคนี้ (อาจถูกลบไปแล้ว)');

  var it = table_('Items');
  var itemIdx = [];
  it.rows.forEach(function (r, k) { if (String(r[it.col.projectId]) === String(data.id)) itemIdx.push(k); });
  deleteRowIndexes_(it, itemIdx);
  deleteRowIndexes_(pt, [i]);
  return { id: data.id, deletedItems: itemIdx.length };
}

function reorderProjects_(data) {
  if (!Array.isArray(data.ids)) throw new Error('ids ต้องเป็น array');
  var t = table_('Projects');
  if (!t.rows.length) return { updated: 0 };
  var pos = {};
  data.ids.forEach(function (id, k) { pos[String(id)] = k; });
  var ts = now_();
  var orders = [];
  var updated = [];
  var changed = 0;
  t.rows.forEach(function (r) {
    var id = String(r[t.col.id]);
    var cur = Number(r[t.col.order]) || 0;
    var next = id in pos ? pos[id] : data.ids.length + cur;
    orders.push([next]);
    if (next !== cur) { updated.push([ts]); changed++; } else updated.push([r[t.col.updatedAt]]);
  });
  t.sh.getRange(2, t.col.order + 1, orders.length, 1).setValues(orders);
  t.sh.getRange(2, t.col.updatedAt + 1, updated.length, 1).setNumberFormat('@').setValues(updated);
  return { updated: changed };
}

/**
 * ซิงก์รายชื่อโปรเจคกับ repo ที่ GITHUB_TOKEN เข้าถึงได้
 * data.dryRun        true = แค่คืนรายการที่จะเปลี่ยน ไม่เขียนจริง
 * data.removeUnlinked true = ลบโปรเจคที่ไม่ได้ผูก repo และยังไม่มีรายการ checklist
 */
function syncGithub_(data) {
  var repos = listGithubRepos_();
  var pt = table_('Projects');
  var projects = pt.rows.filter(function (r) { return r[pt.col.id] !== ''; })
    .map(function (r) { return toObj_(pt, r); });

  var linked = {};
  projects.forEach(function (p) { if (p.repo) linked[p.repo.toLowerCase()] = true; });
  var toAdd = repos.filter(function (r) { return !linked[r.fullName.toLowerCase()]; });

  var toRemove = [];
  if (data.removeUnlinked) {
    var it = table_('Items');
    var hasItems = {};
    it.rows.forEach(function (r) { hasItems[String(r[it.col.projectId])] = true; });
    toRemove = projects.filter(function (p) { return !p.repo && !hasItems[p.id]; });
  }

  var summary = {
    add: toAdd.map(function (r) { return r.fullName; }),
    remove: toRemove.map(function (p) { return p.name; }),
    totalRepos: repos.length,
  };
  if (data.dryRun) return summary;

  if (toRemove.length) {
    var ids = {};
    toRemove.forEach(function (p) { ids[p.id] = true; });
    var idx = [];
    pt.rows.forEach(function (r, k) { if (ids[String(r[pt.col.id])]) idx.push(k); });
    deleteRowIndexes_(pt, idx);
  }
  if (toAdd.length) {
    pt = table_('Projects');
    var order = maxOrder_(pt);
    var ts = now_();
    appendRows_(pt, toAdd.map(function (r) {
      return {
        id: Utilities.getUuid(),
        name: r.name.slice(0, LIMITS.name),
        dueDate: '',
        note: r.description.slice(0, LIMITS.note),
        repo: r.fullName,
        branch: '',
        order: ++order,
        createdAt: ts,
        updatedAt: ts,
      };
    }));
  }
  return summary;
}

/** repo ทั้งหมดที่ token เข้าถึงได้ (ไม่รวม archived) เรียงตาม push ล่าสุด */
function listGithubRepos_() {
  var gh = (PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || '').trim();
  if (!gh) throw new Error('ยังไม่ได้ตั้งค่า GITHUB_TOKEN ใน Script Properties');
  var repos = [];
  for (var page = 1; page <= 10; page++) {
    var req = githubRequest_('x/x', '', gh);
    var res = UrlFetchApp.fetch('https://api.github.com/user/repos?per_page=100&sort=pushed&page=' + page, req);
    var code = res.getResponseCode();
    if (code !== 200) {
      throw new Error('ดึงรายชื่อ repo จาก GitHub ไม่สำเร็จ (HTTP ' + code + ') — ตรวจ GITHUB_TOKEN ด้วย testGithub()');
    }
    var list = JSON.parse(res.getContentText());
    list.forEach(function (r) {
      if (r.archived) return;
      repos.push({ fullName: r.full_name, name: r.name, description: r.description || '' });
    });
    if (list.length < 100) break;
  }
  return repos;
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

function addItem_(data) {
  var pt = table_('Projects');
  if (findIndex_(pt, data.projectId) < 0) throw new Error('ไม่พบโปรเจคนี้ (อาจถูกลบไปแล้ว)');
  var t = table_('Items');
  var pid = String(data.projectId);
  var ts = now_();
  var item = {
    id: Utilities.getUuid(),
    projectId: pid,
    text: cleanStr_(data.text, 'รายการ', LIMITS.text, true),
    done: false,
    order: maxOrder_(t, function (r) { return String(r[t.col.projectId]) === pid; }) + 1,
    createdAt: ts,
    updatedAt: ts,
  };
  appendRows_(t, [item]);
  return item;
}

function updateItem_(data) {
  var t = table_('Items');
  var i = findIndex_(t, data.id);
  if (i < 0) throw new Error('ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)');
  var item = toObj_(t, t.rows[i]);
  if ('text' in data) item.text = cleanStr_(data.text, 'รายการ', LIMITS.text, true);
  if ('done' in data) item.done = data.done === true || String(data.done).toLowerCase() === 'true';
  if ('order' in data) item.order = Number(data.order) || 0;
  item.updatedAt = now_();
  writeRows_(t, i, [toRow_(t, item)]);
  return item;
}

function deleteItem_(data) {
  var t = table_('Items');
  var i = findIndex_(t, data.id);
  if (i < 0) throw new Error('ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)');
  deleteRowIndexes_(t, [i]);
  return { id: data.id };
}

// ---------------------------------------------------------------------------
// GitHub commits
// ---------------------------------------------------------------------------

function getCommits_() {
  var projects = readObjects_('Projects').filter(function (p) { return p.repo; });
  var result = {};
  if (!projects.length) return result;
  var ghToken = (PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || '').trim();
  if (!ghToken) throw new Error('ยังไม่ได้ตั้งค่า GITHUB_TOKEN ใน Script Properties');

  var keyOf = function (p) { return 'gh:' + p.repo.toLowerCase() + '@' + p.branch; };
  var valid = projects.filter(function (p) {
    return REPO_RE.test(p.repo) && (!p.branch || BRANCH_RE.test(p.branch));
  });
  var keys = unique_(valid.map(keyOf));

  var cache = CacheService.getScriptCache();
  var cached = cache.getAll(keys);
  var byKey = {};
  keys.forEach(function (k) {
    if (k in cached) {
      try { byKey[k] = JSON.parse(cached[k]); } catch (err) { /* fetch again */ }
    }
  });

  var missing = keys.filter(function (k) { return !(k in byKey); });
  if (missing.length) {
    var sample = {};
    valid.forEach(function (p) { sample[keyOf(p)] = p; });
    var requests = missing.map(function (k) { return githubRequest_(sample[k].repo, sample[k].branch, ghToken); });
    var responses = fetchAllSafe_(requests);
    var ok = {};
    var failed = {};
    missing.forEach(function (k, n) {
      var commit = parseCommit_(responses[n]);
      byKey[k] = commit;
      (commit ? ok : failed)[k] = JSON.stringify(commit);
    });
    try {
      if (Object.keys(ok).length) cache.putAll(ok, COMMIT_CACHE_SECONDS);
      if (Object.keys(failed).length) cache.putAll(failed, COMMIT_ERROR_CACHE_SECONDS);
    } catch (err) { /* cache เต็มหรือใหญ่เกิน — ไม่เป็นไร */ }
  }

  projects.forEach(function (p) {
    var k = keyOf(p);
    result[p.id] = k in byKey ? byKey[k] : null;
  });
  return result;
}

function githubRequest_(repo, branch, ghToken) {
  var url = 'https://api.github.com/repos/' + repo + '/commits?per_page=1';
  if (branch) url += '&sha=' + encodeURIComponent(branch);
  var headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    Authorization: 'Bearer ' + ghToken,
  };
  return { url: url, method: 'get', headers: headers, muteHttpExceptions: true };
}

/** fetchAll ทั้งชุด ถ้าล้มทั้งชุด (เช่น network error) ค่อยยิงทีละตัว */
function fetchAllSafe_(requests) {
  try {
    return UrlFetchApp.fetchAll(requests);
  } catch (err) {
    return requests.map(function (req) {
      try { return UrlFetchApp.fetch(req.url, req); } catch (e) { return null; }
    });
  }
}

function parseCommit_(res) {
  if (!res || res.getResponseCode() !== 200) return null;
  try {
    var list = JSON.parse(res.getContentText());
    var c = list && list[0];
    if (!c || !c.commit) return null;
    var author = (c.commit.author && c.commit.author.name) || (c.author && c.author.login) || '';
    var date = (c.commit.author && c.commit.author.date) || (c.commit.committer && c.commit.committer.date) || '';
    return {
      sha: c.sha,
      message: String(c.commit.message || '').split('\n')[0].slice(0, 200),
      author: author,
      date: date,
      url: c.html_url,
    };
  } catch (err) {
    return null;
  }
}

function unique_(arr) {
  var seen = {};
  return arr.filter(function (x) { return seen[x] ? false : (seen[x] = true); });
}
