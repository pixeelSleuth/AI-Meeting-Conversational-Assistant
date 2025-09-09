// UPGRADED POPUP.JS (v5 - Semi-Automated "Hybrid" Flow)

document.addEventListener('DOMContentLoaded', () => {

    // --- Define our persistent storage keys ---
    const SESSION_KEY = "activeSession"; // Holds a COMPLETED analysis (summary, chat, etc)
    const PENDING_KEY = "pendingTranscript"; // Holds a RAW transcript string waiting to be analyzed

    // --- In-memory variables to hold our state ---
    let currentSessionData = null;      // Holds the data for an ACTIVE session
    let pendingTranscriptText = null;   // Holds the text from a PENDING session

    // --- Get all UI elements ---
    const uploadSection = document.getElementById('upload-section');
    const loadingSection = document.getElementById('loading-section');
    const resultsSection = document.getElementById('results-section');

    // Upload section dynamic elements
    const uploadTitle = document.getElementById('upload-title');
    const uploadInstructions = document.getElementById('upload-instructions');
    const fileInputWrapper = document.getElementById('file-input-wrapper');
    
    const fileInput = document.getElementById('transcript-file');
    const langSelect = document.getElementById('language-select');
    const analyzeButton = document.getElementById('analyze-button');

    // Results section dynamic elements
    const summaryCard = document.getElementById('summary-card');
    const summaryContent = document.getElementById('summary-content');
    const translationCard = document.getElementById('translation-card');
    const translationContent = document.getElementById('translation-content');
    const ragCard = document.getElementById('rag-card');
    const chatWindow = document.getElementById('chat-window');
    const chatInput = document.getElementById('chat-input');
    const sendButton = document.getElementById('send-question-button');
    const downloadSummaryBtn = document.getElementById('download-summary-btn');
    const downloadChatBtn = document.getElementById('download-chat-btn');

    // --- Create and append the "re-upload" button (Logic is now updated) ---
    const manualUploadButton = document.createElement('button');
    manualUploadButton.id = 'manual-upload-btn';
    manualUploadButton.textContent = 'Analyze a different transcript';
    manualUploadButton.style.marginTop = '1rem';
    manualUploadButton.classList.add('btn-secondary');
    ragCard.appendChild(manualUploadButton);
    
    manualUploadButton.addEventListener('click', () => {
        if (confirm("Are you sure? This will clear your current summary and chat history.")) {
            // Clear BOTH session and pending keys, just in case
            chrome.storage.local.remove([SESSION_KEY, PENDING_KEY], () => {
                console.log("Active session & pending transcript cleared.");
                currentSessionData = null;
                pendingTranscriptText = null;
                showManualUploadView(); // Show the MANUAL upload view
            });
        }
    });

    // --- API Endpoints ---
    const API_BASE_URL = 'http://localhost:5000/api';
    const PROCESS_ENDPOINT = `${API_BASE_URL}/meetings`;
    const ASK_ENDPOINT = `${API_BASE_URL}/meetings/current_meeting/ask`;

    // --- 1. Main Initialization Logic (Priority Check) ---
 
    (function loadPopupState() {
        showLoadingScreen("Checking for meeting data...");
        
        chrome.storage.local.get([SESSION_KEY, PENDING_KEY], (result) => {
            if (result[SESSION_KEY]) {
                // PRIORITY 1: Found an ACTIVE, COMPLETED session. Load it.
                console.log("Found active session, loading results...");
                currentSessionData = result[SESSION_KEY];
                populateResults(currentSessionData);
                showResultsScreen();

            } else if (result[PENDING_KEY]) {
                // PRIORITY 2: Found a PENDING transcript. Show the "Analyze" screen.
                console.log("Found pending transcript, awaiting analysis...");
                pendingTranscriptText = result[PENDING_KEY]; // Save raw text to our variable
                showPendingAnalysisView(); // Show the modified upload screen

            } else {
                // PRIORITY 3: Found nothing. Show the manual upload screen.
                console.log("No session or pending data. Showing manual upload.");
                showManualUploadView();
            }
        });
    })();


    // --- 2. Analyze Button Click Event (Dual Logic) ---
    // This button now does two different things depending on our state.
    analyzeButton.addEventListener('click', async () => {
        
        let transcriptToAnalyze = null;
        let analysisTitle = "Uploaded Meeting";
        const language = langSelect.value;

        if (pendingTranscriptText) {
            // --- A: PENDING TRANSCRIPT MODE ---
            console.log("Analyzing pending transcript from storage...");
            transcriptToAnalyze = pendingTranscriptText;
            analysisTitle = "Automatically Captured Meeting";

        } else {
            // --- B: MANUAL UPLOAD MODE ---
            console.log("Analyzing manually uploaded file...");
            const file = fileInput.files[0];
            if (!file) {
                alert('Please select a transcript .txt file first.');
                return;
            }
            transcriptToAnalyze = await file.text();
            analysisTitle = file.name;
        }

        // --- Common Analysis Pipeline ---
        if (!transcriptToAnalyze) return; // Safety check
        
        showLoadingScreen("Analyzing transcript... This may take a moment.");
        
        try {
            const payload = {
                transcript: transcriptToAnalyze,
                title: analysisTitle,
                language: language || null
            };
            
            const response = await fetch(PROCESS_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            
            const results = await response.json();
            results.chatLog = [
                { text: 'Your transcript is processed. Ask me anything about it!', sender: 'bot' }
            ];

            // Save the new completed session
            currentSessionData = results;
            chrome.storage.local.set({ [SESSION_KEY]: results }, () => {
                // CRITICAL: Now that analysis is done, clear the pending key
                chrome.storage.local.remove(PENDING_KEY, () => {
                    console.log("New session saved, pending transcript cleared.");
                    pendingTranscriptText = null; // Clear in-memory var
                    populateResults(results);
                    showResultsScreen();
                });
            });

        } catch (error) {
            console.error('Error processing meeting:', error);
            alert(`Failed to analyze meeting: ${error.message}`);
            showManualUploadView(); // Default back to manual view on error
        }
    });

    // --- 3. RAG Chat & Download Handlers (No changes from v4) ---

    
    sendButton.addEventListener('click', sendQuestion);
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendQuestion();
        }
    });

    async function sendQuestion() {
        const question = chatInput.value.trim();
        if (!question) return;
        addChatMessage(question, 'user', true); 
        chatInput.value = '';
        try {
            const response = await fetch(ASK_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ question: question }),
            });
            if (!response.ok) throw new Error(`Server error: ${response.statusText}`);
            const data = await response.json();
            const answer = data.answer || "Sorry, I couldn't find an answer.";
            addChatMessage(answer, 'bot', true); 
        } catch (error) {
            console.error('Error asking question:', error);
            addChatMessage(`Error: ${error.message}`, 'bot', true);
        }
    }

    downloadSummaryBtn.addEventListener('click', () => {
        const summaryText = summaryContent.textContent;
        const translationText = translationContent.textContent;
        const hasTranslation = translationCard.style.display !== 'none';
        let fileContent = "MEETING SUMMARY\n-----------------\n\n" + summaryText;
        if (hasTranslation) {
            fileContent += "\n\n\nTRANSLATION\n-----------------\n\n" + translationText;
        }
        downloadTextAsFile(fileContent, "meeting_summary.txt");
    });

    downloadChatBtn.addEventListener('click', () => {
        if (!currentSessionData || !currentSessionData.chatLog) return;
        const chatLines = currentSessionData.chatLog.map(msg => {
            return msg.sender === 'user' ? `You: ${msg.text}` : `Bot: ${msg.text}`;
        });
        const fileContent = chatLines.join('\n\n');
        downloadTextAsFile(fileContent, "meeting_chat_log.txt");
    });

    function downloadTextAsFile(content, filename) {
        const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }


    // --- 4. UI Helper & State Functions (Updated) ---
    
    function populateResults(sessionData) {
        summaryContent.textContent = sessionData.summary || 'No summary generated.';
        if (sessionData.translated_summary) {
            translationContent.textContent = sessionData.translated_summary;
            translationCard.style.display = 'block';
        } else {
            translationCard.style.display = 'none';
        }
        chatWindow.innerHTML = ''; 
        if (sessionData.chatLog && Array.isArray(sessionData.chatLog)) {
            sessionData.chatLog.forEach(msg => {
                addChatMessage(msg.text, msg.sender, false); 
            });
        }
    }

    function addChatMessage(message, sender, saveToStorage = true) {
        const msgElement = document.createElement('p');
        msgElement.classList.add('chat-msg', `${sender}-msg`);
        msgElement.textContent = message;
        chatWindow.appendChild(msgElement);
        chatWindow.scrollTop = chatWindow.scrollHeight;

        if (saveToStorage && currentSessionData) {
            if (!currentSessionData.chatLog) currentSessionData.chatLog = [];
            currentSessionData.chatLog.push({ text: message, sender: sender });
            chrome.storage.local.set({ [SESSION_KEY]: currentSessionData }, () => {
                 console.log('Chat history auto-saved.');
            });
        }
    }
    
    // --- 5. NEW: Screen View Management Functions ---

    function showManualUploadView() {
        uploadTitle.textContent = "Process Transcript";
        uploadInstructions.textContent = "Upload a .txt transcript to begin.";
        fileInputWrapper.style.display = "block"; // Show file input
        uploadSection.style.display = "block";
        loadingSection.style.display = "none";
        resultsSection.style.display = "none";
    }

    function showPendingAnalysisView() {
        uploadTitle.textContent = "New Meeting Ready!";
        uploadInstructions.textContent = "A new meeting was automatically captured. Select a language (optional) and click Analyze.";
        fileInputWrapper.style.display = "none"; // Hide file input
        uploadSection.style.display = "block";
        loadingSection.style.display = "none";
        resultsSection.style.display = "none";
    }

    function showResultsScreen() {
        uploadSection.style.display = "none";
        loadingSection.style.display = "none";
        resultsSection.style.display = "block";
    }

    function showLoadingScreen(message) {
        loadingSection.querySelector('p').textContent = message || "Loading...";
        uploadSection.style.display = "none";
        loadingSection.style.display = "flex";
        resultsSection.style.display = "none";
    }
});