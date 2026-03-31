
# 🚀 Smart Navigation Assistant (SNA)


## 📌 Problem Statement
Current navigation apps like Google Maps require manual interaction while traveling.  
Users must stop, search, zoom, and manually add stops, which is unsafe and inefficient.

In real-world scenarios, commuters often need quick access to essentials like petrol pumps, restrooms, or hospitals, but there is no hands-free intelligent solution.

---

## 💡 Project Description
Smart Navigation Assistant (SNA) is a voice-first AI-powered navigation web app that allows users to interact with maps using natural speech.

Instead of manually searching, users can simply say:
> “Find nearest petrol pump”

The system:
- Understands the request using AI
- Finds relevant places using Google APIs
- Automatically adds it to the route
- Updates map and ETA instantly

This creates a zero-touch navigation experience optimized for real-world driving.

---

## 🤖 Google AI Usage

### 🧠 Tools / Models Used
- Gemini API (Google AI)
- Google Speech-to-Text API
- Google Text-to-Speech API
- Google Maps JavaScript API
- Google Places API
- Google Directions API

---

### ⚙️ How Google AI Was Used
- Gemini AI interprets user intent from voice/text input  
- Speech-to-Text converts voice into text  
- Text-to-Speech provides voice responses  

Flow:
1. User speaks  
2. Speech → text  
3. Gemini processes intent  
4. Places API fetches results  
5. Route updates automatically  

