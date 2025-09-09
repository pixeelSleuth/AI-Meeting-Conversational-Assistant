# =====================================================================
# --- IMPORTS FOR TF-IDF & COMMON LIBS ---
# =====================================================================
import re
import math
import nltk
from string import punctuation
from nltk.stem import WordNetLemmatizer
from nltk.corpus import stopwords
from nltk.tokenize import word_tokenize, sent_tokenize
from deep_translator import GoogleTranslator

# --- NLTK Model Setup (runs once on server start) ---
print("Downloading NLTK models (stopwords, punkt, punkt_tab, wordnet)...")
nltk.download('stopwords')
nltk.download('punkt')
nltk.download('punkt_tab')
nltk.download('wordnet')
print("NLTK models downloaded.")
# ----------------------------------------------------


# =====================================================================
# --- MODEL 1: TF-IDF (Extractive Summary) ---
# =====================================================================

def summarize_with_tfidf(transcript_text):
    
    #Generates an extractive summary using the TF-IDF model.
   
    print("Generating summary using TF-IDF (extractive) model...")
    
   
    stop_words = set(stopwords.words("english"))
    lemmatizer = WordNetLemmatizer()

    def tokenize_sentence(text):
        return sent_tokenize(text)

    def is_stop_word(word):
        return word.lower() in stop_words

    def tokenize_word(text):
        words = word_tokenize(text)
        lemmatized_words = []
        for word in words:
            if not is_stop_word(word) and word not in punctuation:
                lemmatized_words.append(lemmatizer.lemmatize(word.lower()))
        return lemmatized_words

    def calculate_tf(word, sentence_words):
        return sentence_words.count(word) / len(sentence_words) if len(sentence_words) > 0 else 0

    def calculate_idf(word, all_tokenized_sentences):
        no = sum(1 for sent_words in all_tokenized_sentences if word in sent_words)
        return math.log(len(all_tokenized_sentences) / (no + 1))

    def calculate_tf_idf(sentence, all_tokenized_sentences):
        sentence_words = tokenize_word(sentence)
        if not sentence_words: return 0
        sentence_words_set = set(sentence_words)
        tf_idf_scores = 0
        for word in sentence_words_set:
            tf = calculate_tf(word, sentence_words)
            idf = calculate_idf(word, all_tokenized_sentences)
            tf_idf_scores += (tf * idf)
        return tf_idf_scores

    def find_max_sentence(scores):
        max_score = float('-inf')
        max_sentence = None
        for sentence, score in scores.items():
            if score > max_score:
                max_score = score
                max_sentence = sentence
        return max_sentence

    def n_largest(scores, n):
        sentences = []
        for i in range(n):
            if not scores: break
            max_sentence = find_max_sentence(scores)
            sentences.append(max_sentence)
            del scores[max_sentence]
        return sentences

    def summarize_text(text, length):
        sentences = tokenize_sentence(text)
        if not sentences: return "The provided text was empty or could not be tokenized."
        all_tokenized_sentences = [tokenize_word(s) for s in sentences]
        sentence_scores = {s: calculate_tf_idf(s, all_tokenized_sentences) for s in sentences}
        num_sentences_to_get = min(length, len(sentences))
        selected_sentences = n_largest(sentence_scores, num_sentences_to_get)
        return ' '.join(selected_sentences)

    # --- Main execution for TF-IDF ---
    summary_text = summarize_text(transcript_text, 7)
    main_summary = "\n\nMain Points (TF-IDF):\n"
    for i, sentence in enumerate(summary_text.split(".")):
        clean_sentence = sentence.strip()
        if clean_sentence:
            main_summary += f"\n{i+1}. {clean_sentence}."
    return main_summary


# =====================================================================
# --- MODEL 2: BART (Abstractive Summary) ---
# =====================================================================

def summarize_with_bart(conversation_text):
    
    #Generates an abstractive summary using the BART model.
    #Imports are loaded dynamically only when this function is called.
 
    print("Generating summary using BART (abstractive) model...")
    try:
        # --- DYNAMIC IMPORTS: These are only loaded if this function runs ---
        import torch
        from transformers import BartTokenizer, BartForConditionalGeneration
        # ---------------------------------------------------------------------

        print("Loading BART models (this happens once per server session)...")
        tokenizer = BartTokenizer.from_pretrained('facebook/bart-large-cnn')
        model = BartForConditionalGeneration.from_pretrained('facebook/bart-large-cnn')
        print("BART models loaded.")
        
        desired_length = min(250, len(conversation_text.split()) / 3)
        max_length = int(desired_length * 1.2)
        min_length = int(desired_length * 0.9)

        inputs = tokenizer.encode(conversation_text, truncation=True, max_length=1024, return_tensors='pt')
        summary_ids = model.generate(
            inputs, max_length=max_length, min_length=min_length, num_beams=4,
            no_repeat_ngram_size=2, early_stopping=True
        )
        summary = tokenizer.decode(summary_ids[0], skip_special_tokens=True)

        main_summary_text = "\n\nMain Points (BART):\n"
        for i, sentence in enumerate(summary.split(".")):
            clean_sentence = sentence.strip()
            if clean_sentence:
                main_summary_text += f"\n{i+1}. {clean_sentence}."

        intro_length = max(25, int(len(summary.split()) * 0.3))
        intro_ids = model.generate(
            tokenizer.encode(summary, truncation=True, max_length=1024, return_tensors='pt'),
            max_length=intro_length, num_beams=2, no_repeat_ngram_size=2, early_stopping=True
        )
        intro_text = tokenizer.decode(intro_ids[0], skip_special_tokens=True)
        
        output_text = f"Intro:\n{intro_text}{main_summary_text}\n"
        return output_text
    except Exception as e:
        print(f"Error during BART summarization: {e}")
        return "Could not generate summary."


# =====================================================================
# --- MAIN SWITCHBOARD and TRANSLATION ---
# =====================================================================

def get_summary(transcript_text):
    """
    This is the main function that app.py calls.
    It acts as a switchboard to select which model to run.
    """
    # --- THIS IS THE ONLY LINE YOU EVER NEED TO CHANGE ---
    
    # To use the TF-IDF model, make sure this line is active:
    MODEL_TO_USE = "TF-IDF"
    
    # To use the BART model, change the line above to this:
    #MODEL_TO_USE = "BART"
    
    # ----------------------------------------------------

    if MODEL_TO_USE == "BART":
        return summarize_with_bart(transcript_text)
    else: # Default to TF-IDF
        return summarize_with_tfidf(transcript_text)


def get_translation(text, language='es'):
    
    #Translates text to a specified language.
    
    try:
        translated_text = GoogleTranslator(source='auto', target=language).translate(text)
        print(f"Successfully translated text to '{language}'.")
        return translated_text
    except Exception as e:
        print(f"Error during translation: {e}")
        return "Could not translate text."