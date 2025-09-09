from reportlab.platypus import SimpleDocTemplate, Paragraph
from reportlab.lib.styles import getSampleStyleSheet

def create_pdf_from_text(transcript_text, file_path):
    """
    Generates a PDF file from a given string of text.

    Args:
        transcript_text (str): The meeting transcript text.
        file_path (str): The path to save the generated PDF file.
    """
    try:
        doc = SimpleDocTemplate(file_path)
        styles = getSampleStyleSheet()
        story = [Paragraph(line, styles['Normal']) for line in transcript_text.split('\n')]
        doc.build(story)
        print(f"Successfully created PDF: {file_path}")
        return True
    except Exception as e:
        print(f"Error creating PDF: {e}")
        return False