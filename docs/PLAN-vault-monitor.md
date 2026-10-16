# แผน: เชื่อม JK-Vault + ช่องใส่ไอเดีย + จอมอนิเตอร์ 3D

สถานะ: P0 ตกลงแล้ว (ใช้ค่าที่แนะนำทุกข้อ) · **P1 เขียนโค้ดเสร็จ รอ deploy** (2026-10-16)

## ตอนนี้มีอะไรอยู่

| | Project-Tracker | JK-Vault (Obsidian) |
|---|---|---|
| เก็บอะไร | checklist → % progress, กำหนดส่ง, กลุ่ม, commit ล่าสุด | รายละเอียด, decision, ของที่ค้าง, daily, brief "แนะนำวันนี้" |
| ที่เก็บ | Google Sheets ผ่าน Apps Script | ไฟล์ .md → push ขึ้น `jaikwangg/jk-vault` (private) ด้วย obsidian-git |
| ใครอัปเดต | คนกดในเว็บ | agent (skill `vault-sync`) + คนพิมพ์เอง |
| ใช้ร่วมกันได้ไหม | ใช้ไม่ได้ — มีรายชื่อโปรเจกต์ 2 ชุดที่ไม่รู้จักกัน | |

จุดที่ไม่ต้องเพิ่มเครื่องมืออะไรเลย: Apps Script มี `GITHUB_TOKEN` ที่อ่าน private repo ได้อยู่แล้ว
→ เพิ่ม `jk-vault` เข้าไปใน token เดิม Tracker ก็อ่าน vault ได้ทันที **ไม่ต้องมี server ไม่ต้องรัน Obsidian ทิ้งไว้**

```
Obsidian (jk-vault) ──obsidian-git push──▶ GitHub jk-vault
                                              │ (อ่านอย่างเดียว, cache 10 นาที)
GitHub Pages ── index.html ─┐                 ▼
             └─ monitor.html┴──▶ Apps Script ──▶ Sheets (Projects, Items, Ideas)
                                    └──▶ GitHub API (commit ล่าสุดของแต่ละ repo)
```

## Phase

### P0 — Plan (ตอนนี้)
- ตกลงเรื่องที่ต้องตัดสินใจ (ข้างล่าง) แล้วค่อยเริ่ม P1

### P1 — เชื่อม vault (อ่านอย่างเดียว)
- `Code.gs`: action `vault` อ่าน `Projects/*/*.md` จาก GitHub แล้วดึงแค่ frontmatter (`status`, `summary`, `progress`, `updated`, `phase` ถ้ามี) เก็บใน `CacheService` 10 นาที
- จับคู่โปรเจกต์ด้วยชื่อ repo (เช่น `jaikwangg/KPP-PMS`) ถ้าไม่ตรงก็ใช้ชื่อโน้ต
  - ⚠ บางโน้ตใส่ `repo:` ไม่ครบ (`github/IT-KHO`, `github/PMS-Assistant (…)`) ต้องแก้ให้เป็น `owner/name` ก่อน
- `index.html`: การ์ดโปรเจกต์โชว์ `progress` จาก vault กับวันที่ `updated` และมีปุ่ม **เปิดใน Obsidian** (`obsidian://open?vault=jk-vault&file=…`)
- vault: แก้ `local:` ของโน้ต Project-Tracker (ตอนนี้มี clone บนเครื่องแล้ว)

### P2 — ใส่ไอเดียได้ง่าย
- เพิ่มแผ่น `Ideas` (`id, text, project, createdAt, status = new|imported|dropped`)
- `index.html`: มีช่อง "💡 ไอเดีย" ด้านบน พิมพ์แล้วกด Enter เลือกโปรเจกต์หรือไม่เลือกก็ได้ ใช้ได้ทั้งบนมือถือและคอมเพราะมี PIN อยู่แล้ว
- `vault-sync`: เพิ่มขั้นตอนดึงไอเดียที่ `status=new` → เขียนลงส่วน `## ไอเดีย` ในโน้ตโปรเจกต์ (ถ้าไม่มีโปรเจกต์ให้ลง `Inbox/Inbox.md`) → ตั้ง `status=imported`
- ฝั่ง Obsidian: ใช้ core plugin **Templates** ทำ template ของ "ไอเดีย" ที่มี `project:` ใน frontmatter (ไม่ต้องลง plugin เพิ่ม)

### P3 — จอมอนิเตอร์ 3D (`monitor.html`)
- อยู่ในเว็บเดียวกัน ใช้ session/PIN เดียวกัน (localStorage ใช้ origin เดียวกัน)
- three.js (pin เวอร์ชัน โหลดจาก CDN) ไม่ต้องมี build step
- ฉาก: 1 โปรเจกต์ = 1 ตึก วางเป็นเกาะตาม `group`
  - **ความสูง** = % checklist ที่เสร็จ
  - **สี** = ความสด: เขียว (commit/อัปเดตไม่เกิน 3 วัน) · เหลือง (ไม่เกิน 7 วัน) · แดง (นานกว่านั้น) · เทา (`status: historical`)
  - **ชั้นของตึก** = phase ใหญ่ของโปรเจกต์ ถ้าโน้ตมี `phase:` (phase ที่เสร็จแล้วทึบ phase ปัจจุบันเรืองแสง)
  - มีไอเดียใหม่ = มีจุดลอยเหนือตึก · เลยกำหนดส่ง = ธงแดง
- หมุนกล้องเองช้า ๆ วนโฟกัสทีละโปรเจกต์ทุก ~15 วินาที แล้วโชว์ป้าย `progress` จาก vault กับ commit ล่าสุด
- refresh ข้อมูลทุก 5 นาที (การ poll ต่ออายุ session ไปด้วย ทำให้เปิดทิ้งไว้ได้)
- ถ้าเครื่องไม่มี WebGL ให้แสดงเป็นตาราง 2D แทน

### P4 — ใช้เปิดค้างบนคอม
- เปิดด้วย `chrome --app=<url>/monitor.html --start-fullscreen` และใส่ shortcut ไว้ใน Startup
- ลดแสงตอนกลางคืน และหยุด render ตอนแท็บถูกซ่อน (ประหยัด GPU)
- บนจอ: แจ้งเตือน `GITHUB_TOKEN` ใกล้หมดอายุ และแจ้งเมื่อ vault ไม่ได้ sync เกิน N วัน

## เรื่องที่ต้องตัดสินใจ (ค่าที่แนะนำเป็นตัวหนา)
1. **ไอเดียเข้าทางไหน** — **A: ช่องใน Tracker → Sheets → vault-sync นำเข้า (token ยังอ่านอย่างเดียว)** / B: Apps Script เขียนลง vault ตรง ๆ (ต้องให้สิทธิ์ write กับ jk-vault และอาจชนกับ backup อัตโนมัติของ obsidian-git)
2. **ใครเป็นต้นฉบับของ "สถานะ"** — **checklist อยู่ที่ Tracker ส่วนข้อความ/decision อยู่ที่ vault (ต่างฝ่ายต่างเก็บของตัวเอง ไม่ copy กันไปมา)**
3. **ใส่ `phase:` ใน frontmatter ของโน้ตไหม** (เช่น `phase: '3/5 Hourline'`) — **ใส่ แล้วให้ vault-sync ดูแลค่าให้**
4. โปรเจกต์ที่อยู่ใน vault แต่ไม่มีใน Tracker (และกลับกัน) — **โชว์บนมอนิเตอร์ทั้งหมด แต่เป็นสีจาง**

## ความเสี่ยง
- token หมดอายุ = vault กับ commit หายไปพร้อมกัน → P4 ต้องมีป้ายเตือน
- ทุกครั้งที่แก้ `Code.gs` ต้อง Deploy เป็น New version
- ดึงข้อมูลจาก vault แค่ frontmatter ไม่ส่งเนื้อหาโน้ตไปที่หน้าเว็บ (ใน vault มีเรื่องภายในบริษัท) และยังต้องผ่าน PIN
- quota ของ Apps Script UrlFetch: อ่านโน้ต ~8 ไฟล์ทุก 10 นาที ยังห่างจากเพดานมาก
