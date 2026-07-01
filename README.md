# PaoJot — เว็บแอปพลิเคชันจัดการรายจ่ายพร้อมระบบสกัดข้อมูลเอกสารทางการเงินและแนะนำการออมด้วยปัญญาประดิษฐ์

PaoJot เป็นเว็บแอปพลิเคชันสำหรับจัดการการเงินส่วนบุคคล ที่ช่วยให้ผู้ใช้บันทึกรายรับ-รายจ่าย จัดการบัญชี งบประมาณ และเป้าหมายการออม พร้อมนำเทคโนโลยี OCR และ LLM (Large Language Model) มาช่วยบันทึกรายการอย่างรวดเร็วผ่านแชท สแกนใบเสร็จ/สลิป และสรุปภาพรวมทางการเงินให้โดยอัตโนมัติ

## ฟีเจอร์หลัก

- **ระบบสมาชิก** รองรับการสมัคร/เข้าสู่ระบบด้วยอีเมล-รหัสผ่าน และเข้าสู่ระบบผ่านบัญชี Google
- **จัดการบัญชีเงิน** หลายประเภท (เงินสด บัญชีธนาคาร บัญชีออมทรัพย์ กระเป๋าเงินอิเล็กทรอนิกส์ ฯลฯ) พร้อมคำนวณยอดคงเหลืออัตโนมัติ
- **บันทึกรายการ** รายรับ รายจ่าย และการโอนเงิน พร้อมปรับยอดบัญชีให้ถูกต้อง
- **บันทึกรายการเร็วผ่านแชท** พิมพ์ข้อความภาษาธรรมชาติ เช่น "กาแฟ 50" แล้วใช้ LLM แยกชื่อรายการ จำนวนเงิน และแนะนำหมวดหมู่
- **สแกนใบเสร็จ/สลิปด้วย OCR** อัปโหลดหรือถ่ายรูปเอกสาร แล้วสกัดข้อมูลอัตโนมัติ รองรับหลายไฟล์และตรวจจับรายการซ้ำ
- **สรุปการเงินด้วย AI** รายสัปดาห์และรายเดือน
- **จัดการงบประมาณ** ตามหมวดหมู่และรอบเวลา พร้อมติดตามความคืบหน้า
- **เป้าหมายการออม** ฝาก/ถอนเงินเข้าเป้าหมาย พร้อมติดตามสถานะ
- **รายการประจำและการแจ้งเตือน** เตือนเมื่อถึงกำหนดบันทึก งบประมาณ หรือเป้าหมาย
- **แดชบอร์ดและการวิเคราะห์** แสดงภาพรวมสถานะทางการเงิน
- **รองรับ Responsive และ Dark Mode**

---

## สถาปัตยกรรมของระบบ (System Architecture)

ระบบแบ่งออกเป็น 3 ส่วนหลัก ได้แก่ ส่วนหน้าเว็บ (Frontend) ส่วนเซิร์ฟเวอร์ (Backend API) และฐานข้อมูล (Database) โดยเชื่อมต่อกับบริการภายนอกสำหรับงาน AI และการจัดเก็บไฟล์

```
                        ┌─────────────────────────────┐
                        │        External Services     │
                        │  ┌───────────────────────┐   │
                        │  │ Typhoon LLM (OCR)      │   │
                        │  │ Gemini (สรุปการเงิน)   │   │
                        │  │ Google OAuth           │   │
                        │  │ Cloudflare R2 (ไฟล์)   │   │
                        │  └───────────────────────┘   │
                        └──────────────▲──────────────┘
                                       │ HTTPS
   ┌──────────────┐   REST API   ┌─────┴────────┐   SQL    ┌──────────────┐
   │  Frontend    │ ───────────► │  Backend API │ ───────► │  PostgreSQL  │
   │  React (CRA) │   /api/v1    │  Go + Gin    │   pgx    │              │
   │              │ ◄─────────── │              │ ◄─────── │              │
   └──────────────┘   JSON/JWT   └──────────────┘          └──────────────┘
```

**การทำงานโดยรวม**

- **Frontend (React)** ทำหน้าที่แสดงผลและรับข้อมูลจากผู้ใช้ เรียกใช้งาน Backend ผ่าน REST API ที่ `/api/v1` และแนบ JWT ในส่วนหัว `Authorization` เพื่อยืนยันตัวตน
- **Backend (Go + Gin)** ให้บริการ REST API จัดการตรรกะทางธุรกิจทั้งหมด ตรวจสอบสิทธิ์ด้วย JWT (custom auth) เชื่อมต่อฐานข้อมูลด้วยไลบรารี pgx และเรียกใช้บริการ AI ภายนอก
- **Database (PostgreSQL)** จัดเก็บข้อมูลผู้ใช้ บัญชี ธุรกรรม งบประมาณ เป้าหมาย งานสแกน และผลสรุป AI 
- **บริการภายนอก**
  - **Typhoon LLM** ใช้อ่านและสกัดข้อมูลจากใบเสร็จ/สลิป (OCR) และช่วยจำแนกหมวดหมู่รายการจากข้อความ
  - **Gemini** ใช้สร้างสรุปภาพรวมทางการเงินรายสัปดาห์/รายเดือน
  - **Google OAuth** ใช้สำหรับเข้าสู่ระบบด้วยบัญชี Google
  - **Cloudflare R2** ใช้จัดเก็บไฟล์รูปสลิป/ใบเสร็จ (หากไม่ตั้งค่า ระบบจะเก็บไฟล์ลงเครื่องแทน)

**การประมวลผลงานสแกน (Batch + Asynchronous):** เมื่อผู้ใช้อัปโหลดเอกสารหลายไฟล์ ระบบจะสร้างงานสแกน (scan job) และประมวลผลแบบเบื้องหลังผ่านคิวในฐานข้อมูล เพื่อไม่ให้ผู้ใช้ต้องรอทีละไฟล์ แล้วรายงานความคืบหน้ากลับไปยังหน้าเว็บ

---

## เทคโนโลยีที่ใช้ (Tech Stack)

| ส่วน | เทคโนโลยี |
|------|-----------|
| Frontend | React (Create React App), React Router, Tailwind CSS, lucide-react |
| Backend | Go 1.25, Gin, pgx (PostgreSQL driver), golang-jwt, oauth2 |
| Database | PostgreSQL |
| AI / LLM | Typhoon (`typhoon-v2.5-30b-a3b-instruct`) สำหรับ OCR/จำแนกหมวดหมู่ (`typhoon-ocr`), Gemini (`gemini-2.5-flash`) สำหรับสรุปการเงิน |
| Auth | JWT (custom, HS256) + Google OAuth |
| File Storage | Cloudflare R2 (มี local fallback) |
| Deployment | Frontend: Vercel, Backend: Render (Docker), Database: Supabase |

---

## โครงสร้างโปรเจกต์

```
PaoJot/
├── backend/                    # Go + Gin REST API
│   ├── cmd/main.go             # จุดเริ่มต้นของโปรแกรม
│   ├── internal/
│   │   ├── account/            # จัดการบัญชีเงิน
│   │   ├── aisummary/          # สรุปการเงินด้วย AI (Gemini)
│   │   ├── auth/               # สมัคร/เข้าสู่ระบบ/JWT/Google OAuth
│   │   ├── budget/             # งบประมาณ
│   │   ├── category/           # หมวดหมู่
│   │   ├── config/             # โหลดค่าจาก environment
│   │   ├── connectdb/          # เชื่อมต่อฐานข้อมูล (pgx pool)
│   │   ├── middleware/         # ตรวจสอบ JWT
│   │   ├── notification/       # การแจ้งเตือน
│   │   ├── profile/            # โปรไฟล์ผู้ใช้
│   │   ├── quickentry/         # บันทึกรายการเร็วผ่านแชท (LLM)
│   │   ├── recurring/          # รายการประจำ
│   │   ├── router/             # กำหนดเส้นทาง API + CORS
│   │   ├── savingsgoal/        # เป้าหมายการออม
│   │   ├── scan/               # สแกนใบเสร็จ/สลิป (OCR)
│   │   ├── shared/             # โมดูลใช้ร่วม (เช่น storage)
│   │   └── transaction/        # รายการธุรกรรม
│   ├── Dockerfile
│   └── .env.example
├── frontend/                   # React (CRA)
│   ├── public/
│   ├── src/
│   │   ├── components/         # คอมโพเนนต์ใช้ซ้ำ (layout, common)
│   │   ├── contexts/           # React Context (Auth, Snackbar ฯลฯ)
│   │   ├── pages/              # หน้าเข้าสู่ระบบ ฯลฯ
│   │   ├── services/api.js     # API client กลาง
│   │   ├── views/              # หน้าหลักแต่ละฟีเจอร์
│   │   └── App.js
├── database/
│   └── docker/init.sql         # โครงสร้างฐานข้อมูล + ข้อมูลเริ่มต้น
└── README.md
```

---

## การติดตั้งและรันในเครื่อง (Local Setup)

**สิ่งที่ต้องมี:** Go 1.25+, Node.js 18+, PostgreSQL

**1. ฐานข้อมูล** — สร้างฐานข้อมูลและรันสคริปต์โครงสร้าง

```bash
createdb paomoney
psql -d paomoney -f database/docker/init.sql
```

**2. Backend**

```bash
cd backend
cp .env.example .env          # แล้วแก้ค่าตามคู่มือด้านล่าง
go mod download
go run ./cmd/main.go          # รันที่ http://localhost:8080
```

**3. Frontend**

```bash
cd frontend
cp .env.example .env          # local เว้นว่างได้
npm install
npm start                     # รันที่ http://localhost:3000
```

---

## คู่มือการตั้งค่า .env

### Backend (`backend/.env.example`)

คัดลอกไฟล์ `.env.example` เป็น `.env` แล้วกรอกค่าให้เหมาะกับแต่ละสภาพแวดล้อม

**ฐานข้อมูล (Database)**

| ตัวแปร | คำอธิบาย | ตัวอย่าง (Local) | หมายเหตุ (Prod / Supabase) |
|--------|----------|------------------|----------------------------|
| `DB_HOST` | โฮสต์ของฐานข้อมูล | `localhost` | 
| `DB_PORT` | พอร์ต | `5432` | ตามที่ Supabase กำหนด |
| `DB_USER` | ชื่อผู้ใช้ | `postgres` | `postgres.<project-ref>` |
| `DB_PASSWORD` | รหัสผ่าน | `postgres` | รหัสผ่านฐานข้อมูลของ Supabase |
| `DB_NAME` | ชื่อฐานข้อมูล | `paomoney` | `postgres` |
| `DB_SSLMODE` | โหมด SSL | `disable` | `require` |

**เซิร์ฟเวอร์ (Server)**

| ตัวแปร | คำอธิบาย | หมายเหตุ |
|--------|----------|----------|
| `SERVER_PORT` | พอร์ตของ Backend | Local ใช้ `8080` ก็พอ; บน Render จะใช้ตัวแปร `PORT` ที่แพลตฟอร์มกำหนดให้เอง |
| `GIN_MODE` | โหมดของ Gin | โปรดักชันตั้งเป็น `release` (ตั้งผ่าน environment จริง ไม่ใช่ไฟล์ `.env`) |

**การยืนยันตัวตน (JWT)**

| ตัวแปร | คำอธิบาย | หมายเหตุ |
|--------|----------|----------|
| `JWT_SECRET` | คีย์ลับสำหรับเซ็น JWT | **สำคัญ**: โปรดักชันต้องเป็นค่าสุ่มยาว ๆ ห้ามใช้ค่าอย่าง `secret` (สร้างด้วย `openssl rand -base64 48`) |
| `JWT_ACCESS_EXPIRES` | อายุ access token | เช่น `15m` |
| `JWT_REFRESH_EXPIRES` | อายุ refresh token | เช่น `168h` (7 วัน) |

**Google OAuth**

| ตัวแปร | คำอธิบาย | หมายเหตุ |
|--------|----------|----------|
| `GOOGLE_CLIENT_ID` | Client ID จาก Google Cloud Console | ต้องเปิดใช้ OAuth 2.0 Client |
| `GOOGLE_CLIENT_SECRET` | Client Secret | เก็บเป็นความลับ |
| `GOOGLE_REDIRECT_URL` | URL ปลายทางหลังยืนยันตัวตน | Local: `http://localhost:8080/api/v1/auth/google/callback`; Prod: `https://<your-backend>.onrender.com/api/v1/auth/google/callback` (ต้องเพิ่มใน Authorized redirect URIs ของ Google Console ด้วย) |

**CORS**

| ตัวแปร | คำอธิบาย | หมายเหตุ |
|--------|----------|----------|
| `CORS_ALLOWED_ORIGINS` | รายการ origin ที่อนุญาต (คั่นด้วย comma)
| `FRONTEND_URL` | URL ของหน้าเว็บ | Local: `http://localhost:3000` |

**LLM: Gemini (สรุปการเงิน)**

| ตัวแปร | คำอธิบาย | หมายเหตุ |
|--------|----------|----------|
| เข้าไปที่เว็บไซต์ https://aistudio.google.com/
| `GEMINI_API_KEY` | API key ของ Gemini | จำเป็นสำหรับฟีเจอร์สรุปการเงินด้วย AI |
| `GEMINI_BASE_URL` | Base URL ของ API | ค่าเริ่มต้น `https://generativelanguage.googleapis.com/v1beta/openai` |
| `GEMINI_MODEL` | ชื่อโมเดล | ค่าเริ่มต้น `gemini-2.5-flash` |

**LLM: Typhoon (OCR / จำแนกหมวดหมู่)**

| ตัวแปร | คำอธิบาย | หมายเหตุ |
|--------|----------|----------|
| เข้าไปที่เว็บไซต์ https://playground.opentyphoon.ai/
| `TYPHOON_API_KEY` | API key ของ Typhoon | จำเป็นสำหรับฟีเจอร์สแกนเอกสารและบันทึกรายการเร็วผ่านแชท |
| `TYPHOON_BASE_URL` | Base URL ของ API | ค่าเริ่มต้น `https://api.opentyphoon.ai/v1` |
| `TYPHOON_EXTRACT_MODEL` | ชื่อโมเดล | ค่าเริ่มต้น `typhoon-v2.5-30b-a3b-instruct` |

**File Storage: Cloudflare R2 (ไม่บังคับ)**

| ตัวแปร | คำอธิบาย | หมายเหตุ |
|--------|----------|----------|
| `R2_ACCOUNT_ID` | Account ID ของ Cloudflare | หากไม่ตั้งค่ากลุ่ม R2 ทั้งหมด ระบบจะเก็บไฟล์ลงเครื่อง (local) แทน |
| `R2_ACCESS_KEY` | Access Key | — |
| `R2_SECRET_KEY` | Secret Key | เก็บเป็นความลับ |
| `R2_BUCKET` | ชื่อ bucket | — |
| `R2_PUBLIC_URL` | URL สาธารณะสำหรับเข้าถึงไฟล์ | — |


