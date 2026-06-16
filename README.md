# MoodMorph 🎵
### Real-Time Emotion-Adaptive Music Generation

> **AIML Internship Project** | Multi-modal AI • Affective Computing • Generative Audio

MoodMorph detects your facial emotion in real-time using computer vision and synthesizes adaptive music that either **mirrors your mood** or **therapeutically shifts it** toward calm — all running locally with no paid APIs.

---

## Architecture

```
Webcam (30fps)
    │
    ▼
DeepFace (emotion classifier)
    │   → 7 emotions → valence/arousal score (Russell Circumplex Model)
    ▼
FastAPI WebSocket backend
    │   → maps emotion → musical profile (scale, BPM, root note, reverb)
    ▼
Browser (Web Audio API)
    │   → oscillators + chord scheduler + reverb
    ▼
Live Music + Waveform Visualizer
```

**Mode A — Mirror:** music matches your current emotional state (high arousal → fast phrygian, sad → slow minor)  
**Mode B — Shift:** music is remapped toward calm/happy to therapeutically guide your mood

---

## Tech Stack

| Layer | Technology |
|---|---|
| Emotion Detection | DeepFace (FER+ model, runs locally) |
| Real-time Transport | FastAPI WebSocket |
| Music Synthesis | Web Audio API (OscillatorNode, GainNode, ConvolverNode) |
| Emotion Model | Russell Circumplex (Valence × Arousal) |
| Frontend | Vanilla JS + HTML5 Canvas |
| Backend | Python FastAPI + Uvicorn |

---

## Quick Start

### 1. Clone / download the project
```bash
git clone https://github.com/YOUR_USERNAME/moodmorph.git
cd moodmorph
```

### 2. Create a virtual environment
```bash
python -m venv venv

# Windows
venv\Scripts\activate

# Mac / Linux
source venv/bin/activate
```

### 3. Install dependencies
```bash
pip install -r requirements.txt
```
> First run downloads DeepFace models (~500MB) automatically. Let it finish.

### 4. Run the server
```bash
uvicorn app:app --reload --port 8000
```

### 5. Open in browser
```
http://localhost:8000
```
Click **Start** → allow camera → watch emotion + music adapt in real time.

---

## Project Structure

```
moodmorph/
├── app.py                  # FastAPI backend + DeepFace analysis + WebSocket
├── requirements.txt
├── templates/
│   └── index.html          # Full UI with visualizer + circumplex chart
└── static/
    ├── css/
    │   └── style.css       # Design system
    └── js/
        ├── audio.js        # Web Audio Engine (scales, chords, reverb)
        └── app.js          # WebSocket controller + UI logic
```

---

## Music Profiles

| Emotion | Scale | BPM | Character |
|---|---|---|---|
| Happy | Major | 128 | Bright arpeggios |
| Sad | Minor | 58 | Slow minor chords |
| Angry | Phrygian | 150 | Tense fast rhythm |
| Anxious (Fear) | Diminished | 90 | Unstable tension |
| Surprised | Lydian | 140 | Dreamy bright |
| Neutral | Pentatonic | 90 | Balanced calm |
| Disgusted | Locrian | 75 | Dark dissonant |

---

## Roadmap (V2)

- [ ] Voice tone analysis via `librosa` for dual-modal emotion (face + voice)
- [ ] Meta MusicGen API integration for AI-generated audio (replace Web Audio)
- [ ] Mood timeline export (CSV + chart)
- [ ] Multi-face support for group therapy sessions
- [ ] MIDI export of generated music

---

## Research Basis

- Russell, J.A. (1980). *A circumplex model of affect.* Journal of Personality and Social Psychology
- Thayer, R.E. (1989). *The Biopsychology of Mood and Arousal.*
- Eerola, T. & Vuoskoski, J.K. (2011). *A comparison of the discrete and dimensional models of emotion in music.*

---

## License
MIT — free for personal, academic, and commercial use.

---

*Built for AIML Internship | Demonstrates: Computer Vision · Affective Computing · Generative Audio · Real-time ML*
