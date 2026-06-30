from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from app.services.parser_service import ResumeParser
from app.db.supabase import supabase

router = APIRouter()

@router.post("/upload-resume")
async def upload_resume(user_id: str = Form(...), file: UploadFile = File(...)):
    try:
        file_bytes = await file.read()
        
        # 1. AI ke liye text nikalna (Zaroori hai AI ke dimaag ke liye)
        raw_text = ResumeParser.extract_text_from_pdf(file_bytes)
        
        # 2. Asli PDF ko Supabase Storage mein upload karna
        # Path: user_id/resume.pdf
        file_path = f"{user_id}/resume.pdf"
        
        # Storage mein upload
        supabase.storage.from_("resumes").upload(
            path=file_path,
            file=file_bytes,
            file_options={"content-type": "application/pdf", "upsert": "true"}
        )

        # 3. Database mein record save karna
        data = {
            "user_id": user_id,
            "raw_text": raw_text,
            "file_path": file_path
        }
        supabase.table("resumes").upsert(data, on_conflict="user_id").execute()
        
        return {"message": "Original PDF uploaded successfully!"}
    except Exception as e:
        print(f"Upload Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))