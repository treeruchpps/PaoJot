# PaoJot — คู่มือ Deploy

Stack: **Vercel** (frontend, static) · **Render** (backend, Go) · **Supabase** (Postgres เป็น DB อย่างเดียว)
ระบบ Auth เป็น **custom JWT ของแอปเอง** (ไม่ได้ใช้ Supabase Auth)

---

## 0. เตรียมก่อน push ขึ้น Git

- repo เดียว (monorepo) ทั้ง `backend/` `frontend/` `database/` — ไม่ต้องแยก
- ตรวจว่า `.env` / `uploads/` ไม่หลุดขึ้น Git:
  ```bash
  git status        # ต้องไม่เห็น .env หรือ backend/uploads/
  ```
- commit เฉพาะไฟล์ `*.env.example` (ค่าจริงไปใส่ที่ platform)

---

## 1. Supabase — Database

1. สร้าง project → ตั้ง **database password** (เก็บไว้ใช้ต่อ)
2. รัน schema **ครั้งเดียว**: เปิด **SQL Editor** → วางเนื้อหา `database/docker/init.sql` ทั้งหมด → Run
   - หมายเหตุ: `init.sql` ไม่มี `IF NOT EXISTS` รันซ้ำจะ error → รันครั้งเดียวบน DB เปล่า
3. เก็บค่า connection แบบ **Session pooler** (Connect → Session pooler): IPv4 + รองรับ prepared statement ของ pgx
   - `DB_HOST = aws-0-<region>.pooler.supabase.com`
   - `DB_USER = postgres.<project-ref>`
   - `DB_NAME = postgres`, `DB_PORT = 5432`, `DB_SSLMODE = require`
   - ⚠️ อย่าใช้ Direct connection (IPv6-only → Render ต่อไม่ได้)

> Free tier: project จะ **pause เมื่อไม่มี DB activity 7 วัน** — ถ้าจะปล่อยทิ้งนาน ตั้ง cron เบาๆ ยิง query กันพัก

---

## 2. Render — Backend (Go)

1. New → Web Service → เชื่อม repo, ตั้ง **Root Directory = `backend`** (build จาก Dockerfile)
2. ตั้ง Environment Variables:

   | Key | ค่า |
   |-----|-----|
   | `DB_HOST` | `aws-0-<region>.pooler.supabase.com` |
   | `DB_PORT` | `5432` |
   | `DB_USER` | `postgres.<project-ref>` |
   | `DB_PASSWORD` | database password ของ Supabase |
   | `DB_NAME` | `postgres` |
   | `DB_SSLMODE` | `require` |
   | `JWT_SECRET` | ค่าสุ่มยาวๆ (`openssl rand -base64 48`) |
   | `GOOGLE_CLIENT_ID` | จาก Google Console |
   | `GOOGLE_CLIENT_SECRET` | จาก Google Console |
   | `GOOGLE_REDIRECT_URL` | `https://<backend>.onrender.com/api/v1/auth/google/callback` |
   | `FRONTEND_URL` | `https://<your-app>.vercel.app` |
   | `CORS_ALLOWED_ORIGINS` | `https://<your-app>.vercel.app` |
   | `GIN_MODE` | `release` |
   | `GEMINI_API_KEY` | ถ้าใช้สรุป AI |
   | `TYPHOON_API_KEY` | ถ้าใช้สแกนใบเสร็จ |
   | `R2_*` | ถ้าจะเก็บไฟล์ถาวร (ไม่ตั้ง = เก็บ local แล้วหายตอน redeploy) |

   - ไม่ต้องตั้ง `PORT` (Render ใส่ให้เอง, โค้ดอ่าน `PORT` ก่อน `SERVER_PORT`)
3. Deploy แล้วจด URL: `https://<backend>.onrender.com`

> Free tier: **spin down หลังไม่มี request 15 นาที** → request แรกหลัง idle ช้า ~30–60 วิ (cold start)

---

## 3. Google OAuth (backend จัดการเอง)

1. Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client (Web application)
2. **Authorized redirect URIs** เพิ่ม:
   - `https://<backend>.onrender.com/api/v1/auth/google/callback` (prod)
   - `http://localhost:8080/api/v1/auth/google/callback` (dev)
3. consent screen: scope แค่ `email` + `profile` → publish เป็น **Production** ได้เลยไม่ต้อง verify (ตอนจะเปิดให้คนอื่นใช้)

---

## 4. Vercel — Frontend (React)

1. Import repo → ตั้ง **Root Directory = `frontend`** (detect CRA ให้เอง, มี `vercel.json` ทำ SPA rewrite แล้ว)
2. Environment Variables:
   - `REACT_APP_API_URL = https://<backend>.onrender.com/api/v1`
   - (เป็น build-time — แก้แล้วต้อง redeploy)
3. Deploy แล้วจดโดเมน: `https://<your-app>.vercel.app`

---

## 5. เชื่อมให้ครบ (ถ้าไม่ได้ตั้งชื่อ service ล่วงหน้า)

หลังได้ URL จริงทั้งคู่ ย้อนอัปเดต:
- Render: `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS` = โดเมน Vercel
- Google Console: redirect URI = callback ของ Render
- Vercel: `REACT_APP_API_URL` = URL ของ Render

---

## 6. เทสต์ end-to-end

- สมัคร / เข้าสู่ระบบ (email + password)
- เข้าสู่ระบบด้วย Google
- บันทึกรายรับ/จ่าย, งบประมาณ, เป้าหมาย
- (ถ้าตั้ง key) สแกนใบเสร็จ + สรุป AI

---

## ลำดับแนะนำ

**Supabase (รัน init.sql) → Render (ใส่ env) → Vercel (ใส่ env) → อัปเดต URL เชื่อมกัน + Google redirect → เทสต์**

> ทริค: ตั้งชื่อ service ล่วงหน้า (เช่น `paojot-api.onrender.com`, `paojot.vercel.app`) จะกรอก env ถูกตั้งแต่รอบแรก ไม่ต้องย้อนแก้

---

## รู้ไว้ (free tier)

- **Render** spin down 15 นาที → cold start ครั้งแรกช้า
- **Supabase** pause หลัง 7 วันไม่มี DB activity → ต้อง restore เอง (ตั้ง cron กันได้)
- **Vercel** static CDN → ไม่มีปัญหา idle
- งานสแกน OCR รันแบบ background goroutine — ถ้า Render หลับกลางคันงานอาจค้าง (ความเสี่ยงต่ำตอนมีคนใช้จริง)
- ระบบ **ไม่มียืนยันอีเมล** (เช็กแค่รูปแบบอีเมลตอนสมัคร)
