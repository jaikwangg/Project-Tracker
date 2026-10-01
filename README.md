# Project Tracker

เว็บหน้าเดียวสำหรับติดตาม progress หลายโปรเจค — progress คำนวณจาก checklist ที่ติ๊กแล้ว, ข้อมูลเก็บใน Google Sheets, แสดง commit ล่าสุดจาก GitHub, เข้าใช้งานด้วย PIN 6 หลัก

```
GitHub Pages (index.html + config.js) → fetch → Apps Script Web App → Google Sheets
                                                       └→ GitHub REST API
```

| ไฟล์ | หน้าที่ |
|---|---|
| `index.html` | หน้าเว็บทั้งหมด (HTML + CSS + JS) |
| `config.js` | URL ของ Apps Script (`API_URL`) |
| `apps-script/Code.gs` | backend ทั้งหมด |

## ติดตั้ง

### 1. สร้าง backend
1. สร้าง Google Sheet ใหม่ → **Extensions → Apps Script**
2. ลบโค้ดเดิม วางเนื้อหา `apps-script/Code.gs` → **Save**
   (แผ่น `Projects` และ `Items` จะถูกสร้างให้อัตโนมัติตอนเรียกใช้ครั้งแรก)

### 2. ตั้ง PIN
1. ใน editor หาฟังก์ชัน `setPin()` แล้วใส่ PIN 6 หลักชั่วคราว: `var NEW_PIN = 'ใส่ PIN 6 หลักของคุณ';`
2. เลือกฟังก์ชัน `setPin` ในแถบด้านบน → **Run** (ครั้งแรกจะขอสิทธิ์ → Allow)
3. **ลบ PIN ออกทันที** ให้กลับเป็น `var NEW_PIN = '';` แล้ว Save
4. ตรวจที่ **Project Settings → Script Properties** ต้องมี `PIN_SALT` และ `PIN_HASH` (เป็น hash ไม่ใช่ PIN จริง)

> ห้าม commit PIN หรือค่า `PIN_HASH`/`PIN_SALT` ลง repo — ค่าเหล่านี้อยู่ใน Script Properties เท่านั้น

### 3. GitHub token (บังคับ — repo ทั้งหมดเป็น private)
1. GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**
2. **Resource owner**
   - repo ส่วนตัว → เลือกบัญชีตัวเอง
   - repo ใน **Organization** → เลือกชื่อ org (ถ้า org บังคับให้อนุมัติ token แอดมินของ org ต้องกด approve ก่อน token จึงใช้ได้ — ดูได้ที่ org → Settings → Personal access tokens → Pending requests)
   - ถ้ามี repo ทั้งส่วนตัวและใน org: token หนึ่งตัวเลือก owner ได้แค่หนึ่งเจ้า → แนะนำย้าย/ให้สิทธิ์ให้อยู่ owner เดียวกัน หรือใช้ token ของ owner ที่มี repo มากกว่า (โปรเจคที่อ่านไม่ได้จะแค่ไม่แสดงบรรทัด commit)
3. **Repository access → Only select repositories** → เลือกทุก repo ที่จะผูกกับโปรเจค (เลือกได้หลายตัว; เพิ่ม repo ภายหลังได้โดยแก้ token เดิม ไม่ต้องสร้างใหม่)
4. **Permissions → Repository permissions → Contents: Read-only** (Metadata: Read-only จะถูกเลือกให้เอง)
5. **Expiration**: ตั้งตามนโยบาย (เช่น 90 วัน หรือ 1 ปี) — **จดวันหมดอายุไว้ในปฏิทิน** เมื่อ token หมดอายุ บรรทัด commit จะหายไปทุกโปรเจคโดยไม่มี error อื่น ให้ Regenerate แล้วอัปเดต Script Property
6. copy token → Apps Script **Project Settings → Script Properties → Add property**: `GITHUB_TOKEN` = token

### 4. Deploy Apps Script
1. **Deploy → New deployment → ⚙ Select type: Web app**
2. Execute as: **Me**, Who has access: **Anyone** → Deploy → Authorize
3. copy **Web app URL** (ลงท้าย `/exec`)

### 5. ตั้งค่าหน้าเว็บ
1. แก้ `config.js`: `const API_URL = "https://script.google.com/macros/s/…/exec";` แล้ว commit
   (URL นี้เปิดเผยได้ — ไม่มี PIN ก็อ่านข้อมูลไม่ได้)
2. GitHub repo → **Settings → Pages → Deploy from a branch → `main` / `(root)`**
3. เปิดเว็บ → ใส่ PIN → ใช้งานได้ (จำการเข้าระบบไว้ 30 วัน และต่ออายุเองเมื่อใช้งาน)

### ⚠ ทุกครั้งที่แก้ Code.gs
ต้อง **Deploy → Manage deployments → ✏ Edit → Version: New version → Deploy** ไม่อย่างนั้น URL เดิมยังรันโค้ดเก่า

## เปลี่ยน PIN / เตะทุกเครื่องออก
- **เปลี่ยน PIN**: ทำซ้ำขั้นตอนที่ 2 (`setPin()`) — จะสร้าง salt ใหม่ ล้างตัวนับล็อก และ **ล้าง session ทุกเครื่อง** ให้อัตโนมัติ อย่าลืมลบ PIN ออกจากโค้ดหลังรัน
- **ทำเครื่องหาย / สงสัยว่ามีคนเข้าได้**: ใน editor เลือกฟังก์ชัน `revokeAllSessions` → **Run** → ทุกเครื่องจะเด้งกลับหน้า PIN ในการเรียกครั้งถัดไป (แนะนำเปลี่ยน PIN ด้วย)
- ออกจากระบบเฉพาะเครื่องนี้: ⚙ → **ออกจากระบบ**

## ความปลอดภัยของ PIN
- เก็บเฉพาะ SHA-256 ของ (PIN + salt) ไม่เก็บ PIN จริง
- ผิด 5 ครั้ง → ล็อก 15 นาที; ถูกล็อกครบ 3 รอบติดกัน → ล็อก 24 ชั่วโมง (login สำเร็จจะรีเซ็ตทั้งหมด)
- ระหว่างล็อก การลองใส่ PIN จะไม่ถูกตรวจเลย
- ทุก request ยกเว้น `login` ต้องมี session token ที่ยังไม่หมดอายุ

## สร้างค่าสุ่ม (ถ้าต้องการใช้ทดสอบหรือเป็นค่าลับอื่น)
PowerShell (ใช้ได้ทั้ง 5.1 และ 7):
```powershell
$b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | % { $_.ToString('x2') })
```
macOS / Linux / Git Bash:
```bash
openssl rand -hex 32
```

## การใช้งานสั้นๆ
- คลิกการ์ดเพื่อกาง/พับ · ติ๊ก checkbox เพื่อทำเครื่องหมายเสร็จ
- ดับเบิลคลิก (PC) หรือกดค้าง (มือถือ) ที่ข้อความเพื่อแก้ไข · Enter = บันทึก, Esc = ยกเลิก
- วางข้อความหลายบรรทัดในช่อง "+ เพิ่มรายการ…" → แยกเป็นหลายรายการให้เอง
- ↑ ↓ ในการ์ดที่กางอยู่ = เปลี่ยนลำดับโปรเจค
- สี: แดง = เลยกำหนด, ส้ม = ใกล้กำหนด (≤ 7 วัน) หรือไม่มี commit เกิน 14 วัน, เขียว = เสร็จ
