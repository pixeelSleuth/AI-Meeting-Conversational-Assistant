import os
import nest_asyncio
nest_asyncio.apply()

from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv



# --- New Imports for Server-Side Chat History ---
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory

# Import our custom modules
from pdf_generator import create_pdf_from_text
from rag_processor import create_and_save_rag_index, get_runnable_rag_chain
from summarizer import get_summary, get_translation

load_dotenv()
app = Flask(__name__)
CORS(app)

os.makedirs("saved_pdfs", exist_ok=True)
os.makedirs("faiss_indexes", exist_ok=True)

# --- This will store all chat histories in memory ---
# We still use a dict in case you ever want to expand, but we will only ever use one key.
chat_history_store = {}

# --- DEFINE OUR SINGLETON MEETING ID ---

SINGLETON_MEETING_ID = "current_meeting"

def get_session_history(session_id: str):
    """
    Retrieves or creates a new chat history for a given session_id.
    """
    if session_id not in chat_history_store:
        chat_history_store[session_id] = ChatMessageHistory()
    return chat_history_store[session_id]


@app.route('/')
def home():
    return "Backend server is running!"


@app.route('/api/meetings', methods=['POST'])
def process_meeting():
    data = request.get_json()
    if not data or 'transcript' not in data:
        return jsonify({"error": "Missing 'transcript' in request body"}), 400

    transcript = data.get('transcript')
    title = data.get('title', 'Untitled Meeting')
    language = data.get('language')
    
   
    meeting_id = SINGLETON_MEETING_ID
    print(f"Processing single meeting instance: {meeting_id}, Title: {title}")


    if meeting_id in chat_history_store:
        chat_history_store[meeting_id].clear()
        print(f"Cleared chat history for session: {meeting_id}")
    
    # Define paths using the static ID. These will now overwrite previous files.
    pdf_path = os.path.join("saved_pdfs", f"{meeting_id}.pdf")
    if not create_pdf_from_text(transcript, pdf_path):
        return jsonify({"error": "Failed to create PDF"}), 500

    index_path = os.path.join("faiss_indexes", meeting_id)
    if not create_and_save_rag_index(transcript, index_path):
        return jsonify({"error": "Failed to create RAG index"}), 500

    summary = get_summary(transcript)
    
    translated_summary = None
    if language:
        translated_summary = get_translation(summary, language)

    response_data = {
        "message": "Meeting processed successfully and replaced current instance.",
        "meeting_id": meeting_id, # Return the static ID so the frontend knows what to call
        "summary": summary
    }
    if translated_summary:
        response_data["translated_summary"] = translated_summary

    return jsonify(response_data), 201


@app.route('/api/meetings/<string:meeting_id>/ask', methods=['POST'])
def ask_question(meeting_id):
    """
    This endpoint function remains exactly the same.
    The frontend will just always pass 'current_meeting' as the meeting_id.
    """
    data = request.get_json()
    if not data or 'question' not in data:
        return jsonify({"error": "Missing 'question' in request body"}), 400

    question = data.get('question')

    # 1. Check if the index for this meeting exists
    index_path = os.path.join("faiss_indexes", meeting_id)
    if not os.path.exists(index_path):
        # This error will now only happen if no meeting has *ever* been uploaded.
        return jsonify({"error": "No meeting has been processed yet. Please upload a transcript first."}), 404

    # 2. Get the full runnable chain (with memory)
    runnable_with_history = get_runnable_rag_chain(get_session_history, index_path)

    # 3. Invoke the chain.
    try:
        response = runnable_with_history.invoke(
            {"input": question},
            config={"configurable": {"session_id": meeting_id}} # This will be "current_meeting"
        )
        answer = response.get("answer", "Sorry, I couldn't find an answer.")
        return jsonify({"answer": answer})
        
    except Exception as e:
        print(f"Error invoking RAG chain: {e}")
        return jsonify({"error": "An error occurred while processing your question."}), 500


if __name__ == '__main__':
    app.run(debug=True, port=5000)