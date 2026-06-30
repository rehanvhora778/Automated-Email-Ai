import io
from pypdf import PdfReader
import pdfplumber

class ResumeParser:
    @staticmethod
    def extract_text_from_pdf(file_bytes):
        text = ""
        # Tarika 1: pypdf (Ye font errors ko handle kar leta hai)
        try:
            reader = PdfReader(io.BytesIO(file_bytes))
            for page in reader.pages:
                text += page.extract_text() + "\n"
            
            if text.strip():
                print("Text extracted using pypdf")
                return text
        except Exception as e:
            print(f"pypdf failed: {e}")

        # Tarika 2: pdfplumber (Agar pypdf fail ho jaye tabhi ye chalega)
        try:
            with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
                full_text = ""
                for page in pdf.pages:
                    full_text += page.extract_text() or ""
                return full_text
        except Exception as e:
            print(f"pdfplumber also failed: {e}")
            return None