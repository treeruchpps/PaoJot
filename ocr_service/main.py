import os
import io
import base64
import json
import re
import time
import asyncio
from typing import Annotated, Literal

import requests as http
import pillow_heif
from PIL import Image
from dotenv import load_dotenv
from fastapi import FastAPI, File, UploadFile, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

pillow_heif.register_heif_opener()
load_dotenv()

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
API_KEY       = os.environ.get("TYPHOON_API_KEY", "")
BASE_URL      = os.environ.get("BASE_URL",        "")
OCR_MODEL     = os.environ.get("OCR_MODEL",       "")
EXTRACT_MODEL = os.environ.get("EXTRACT_MODEL",   "")
PORT          = int(os.environ.get("PORT",         8001))

RATE_LIMIT_DELAY = 4
ALLOWED_MIME     = {"image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif"}
HEIC_MIME        = {"image/heic", "image/heif"}

# ---------------------------------------------------------------------------
# Prompts แยกตาม type
# ---------------------------------------------------------------------------
RECEIPT_PROMPT = """ดึงข้อมูลจากใบเสร็จ/ใบกำกับภาษีในข้อความ OCR ด้านล่าง แล้วตอบเป็น JSON นี้เท่านั้น:
{
  "merchant": "ชื่อร้านหรือบริษัท",
  "date": "YYYY-MM-DD",
  "items": [
    {
      "name": "ชื่อรายการสินค้าหรือบริการ",
      "quantity": 1,
      "unit_price": 0.0
    }
  ],
  "total": 0.0,
  "currency": "THB"
}

กฎ:
- ตอบเฉพาะ JSON เท่านั้น ห้ามมีข้อความอื่น
- ถ้าข้อมูลใดหาไม่เจอให้ใส่ null
- date ให้แปลงเป็น YYYY-MM-DD เสมอ
- ตัวเลขเงินให้เป็น float ไม่มี comma
- items ให้ครบทุกรายการที่อ่านได้

ข้อความ OCR:
"""

BANK_SLIP_PROMPT = """ดึงข้อมูลจากสลิปธนาคาร/หลักฐานการโอนเงินในข้อความ OCR ด้านล่าง แล้วตอบเป็น JSON นี้เท่านั้น:
{
  "date": "YYYY-MM-DD",
  "bank": "ชื่อธนาคาร",
  "sender": {
    "name": "ชื่อผู้โอน",
    "account": "เลขบัญชีผู้โอน"
  },
  "receiver": {
    "name": "ชื่อผู้รับ",
    "account": "เลขบัญชีผู้รับ"
  },
  "amount": 0.0,
  "currency": "THB"
}

กฎ:
- ตอบเฉพาะ JSON เท่านั้น ห้ามมีข้อความอื่น
- ถ้าข้อมูลใดหาไม่เจอให้ใส่ null
- date ให้แปลงเป็น YYYY-MM-DD เสมอ
- ตัวเลขเงินให้เป็น float ไม่มี comma

ข้อความ OCR:
"""

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def call_api(messages: list, model: str, max_tokens: int = 2048,
             temperature: float = 1.0, top_p: float = 1.0,
             repetition_penalty: float = 1.0) -> str:
    payload = {
        "model": model,
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "repetition_penalty": repetition_penalty,
    }
    resp = http.post(
        f"{BASE_URL}/chat/completions",
        headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
        json=payload,
        timeout=120,
    )
    if not resp.ok:
        raise RuntimeError(f"Typhoon {resp.status_code}: {resp.text}")
    return resp.json()["choices"][0]["message"]["content"]


def ocr_image(image_bytes: bytes, mime: str) -> str:
    b64 = base64.b64encode(image_bytes).decode("utf-8")
    raw = call_api(
        messages=[
            {
                "role": "user",
                "content": [
                    {"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}},
                    {"type": "text", "text": "OCR เอกสารนี้ให้ครบถ้วน รักษาตัวเลข ชื่อ และวันที่ให้ถูกต้อง เอกสารอาจเป็นภาษาไทยหรือภาษาอังกฤษ:"},
                ],
            }
        ],
        model=OCR_MODEL,
        max_tokens=16384,
        temperature=0.1,
        top_p=0.6,
        repetition_penalty=1.2,
    )
    return raw


def extract(ocr_text: str, doc_type: str) -> dict:
    prompt = RECEIPT_PROMPT if doc_type == "receipt" else BANK_SLIP_PROMPT
    raw = call_api(
        messages=[{"role": "user", "content": prompt + ocr_text}],
        model=EXTRACT_MODEL,
        max_tokens=2048,
    )
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    return json.loads(text.strip())


def heic_to_jpeg(image_bytes: bytes) -> bytes:
    img = Image.open(io.BytesIO(image_bytes))
    buf = io.BytesIO()
    img.convert("RGB").save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def process_single(image_bytes: bytes, mime: str, filename: str, doc_type: str) -> dict:
    # แปลง HEIC → JPEG ก่อนส่ง Typhoon
    if mime in HEIC_MIME:
        image_bytes = heic_to_jpeg(image_bytes)
        mime = "image/jpeg"

    ocr_text = ocr_image(image_bytes, mime)
    time.sleep(RATE_LIMIT_DELAY)
    data = extract(ocr_text, doc_type)
    data["type"]        = doc_type
    data["source_file"] = filename
    return data


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(
    title="TyphoonOCR API",
    description="อัปโหลดรูปใบเสร็จหรือสลิปธนาคาร เพื่อแปลงเป็น JSON",
    version="2.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"status": "ok", "message": "TyphoonOCR API พร้อมใช้งาน"}


@app.post("/process")
async def process_documents(
    file: Annotated[UploadFile, File(description="รูปใบเสร็จหรือสลิป")],
    type: Literal["receipt", "bank_slip"] = Query(description="ประเภทเอกสาร: receipt หรือ bank_slip"),
):
    if not API_KEY:
        raise HTTPException(status_code=500, detail="TYPHOON_API_KEY ยังไม่ได้ตั้งค่า")

    if file.content_type not in ALLOWED_MIME:
        raise HTTPException(
            status_code=400,
            detail=f"ไม่รองรับไฟล์ประเภท {file.content_type} (รองรับ jpg, png, webp)"
        )

    image_bytes = await file.read()
    filename    = file.filename or "file"

    try:
        data = await asyncio.to_thread(process_single, image_bytes, file.content_type, filename, type)
    except json.JSONDecodeError:
        raise HTTPException(status_code=422, detail="แปลง JSON ไม่สำเร็จ")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return JSONResponse({"status": "success", "data": data})


if __name__ == "__main__":
    import uvicorn
    print(f"🚀 OCR Service running at http://localhost:{PORT}")
    print(f"📄 Swagger UI: http://localhost:{PORT}/docs")
    uvicorn.run("main:app", host="0.0.0.0", port=PORT, reload=True)
