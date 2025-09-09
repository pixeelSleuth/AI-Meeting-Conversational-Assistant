import os
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_google_genai import GoogleGenerativeAIEmbeddings
from langchain_community.vectorstores import FAISS
from langchain_groq import ChatGroq

# --- New Imports from your chatbot.py ---
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain.chains import create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain

def create_and_save_rag_index(transcript_text, index_path):
    """
    Creates a FAISS vector index from the transcript and saves it locally.
    (This function is the same as before, adapted from indexer.py logic)
    """
    try:
        if not transcript_text:
            print("Error: Transcript text is empty.")
            return False

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=100)
        chunks = text_splitter.split_text(transcript_text)

        if not chunks:
            print("Error: Could not create chunks from the text.")
            return False
            
        embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")
        vector_store = FAISS.from_texts(chunks, embedding=embeddings)
        vector_store.save_local(index_path)
        
        print(f"Successfully created and saved FAISS index to: {index_path}")
        return True
    except Exception as e:
        print(f"An error occurred in RAG processing: {e}")
        return False


def get_runnable_rag_chain(session_history_retriever_func, index_path: str):
    """
    Creates the modern, runnable RAG chain with chat history.
    This logic is adapted directly from your chatbot.py.
    """
    
    # 1. Initialize the models (Groq for chat, Google for embeddings)
    llm = ChatGroq(temperature=0, model_name="llama-3.1-8b-instant")
    embeddings = GoogleGenerativeAIEmbeddings(model="models/embedding-001")

    # 2. Load the specific FAISS index for this meeting
    vector_store = FAISS.load_local(
        index_path, 
        embeddings, 
        allow_dangerous_deserialization=True
    )
    retriever = vector_store.as_retriever(search_kwargs={"k": 3})

    # 3. Create the Context-Aware Prompt
  
    system_prompt = (
        "You are an assistant for answering questions about a meeting transcript. "
        "Use the provided retrieved context to answer the question. "
        "If you don't know the answer, say that you don't know. "
        "Keep your answers concise and professional based on the context."
        "\n\n"
        "{context}"
    )

    prompt = ChatPromptTemplate.from_messages(
        [
            ("system", system_prompt),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ]
    )

    # 4. Create the main retrieval-aware chain
    # This chain: 1) takes history and input, 2) creates a search query, 
    # 3) gets docs, 4) passes docs, history, and input to the LLM.
    question_answer_chain = create_stuff_documents_chain(llm, prompt)
    rag_chain = create_retrieval_chain(retriever, question_answer_chain)

    # 5. Add History Management
    # This wraps the RAG chain and connects it to our get_session_history function
    conversational_chain = RunnableWithMessageHistory(
        rag_chain,
        session_history_retriever_func, # The function we passed in from app.py
        input_messages_key="input",
        history_messages_key="chat_history",
        output_messages_key="answer",
    )
    
    return conversational_chain