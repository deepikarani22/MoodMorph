from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import base64
import json
import asyncio
from concurrent.futures import ThreadPoolExecutor
from deepface import DeepFace
import time

app = FastAPI(title="MoodMorph")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# Thread pool so DeepFace never blocks the async event loop
_executor = ThreadPoolExecutor(max_workers=2)

# ── Russell Circumplex: map DeepFace emotion → valence/arousal ──────────────
EMOTION_MAP = {
    "happy":    {"valence": 0.9,  "arousal": 0.7,  "label": "Happy",    "emoji": "😊", "color": "#f59e0b"},
    "sad":      {"valence": 0.15, "arousal": 0.2,  "label": "Sad",      "emoji": "😢", "color": "#3b82f6"},
    "angry":    {"valence": 0.1,  "arousal": 0.95, "label": "Angry",    "emoji": "😠", "color": "#ef4444"},
    "fear":     {"valence": 0.1,  "arousal": 0.9,  "label": "Anxious",  "emoji": "😰", "color": "#8b5cf6"},
    "surprise": {"valence": 0.7,  "arousal": 0.85, "label": "Surprised","emoji": "😲", "color": "#06b6d4"},
    "disgust":  {"valence": 0.1,  "arousal": 0.6,  "label": "Disgusted","emoji": "🤢", "color": "#84cc16"},
    "neutral":  {"valence": 0.5,  "arousal": 0.4,  "label": "Neutral",  "emoji": "😐", "color": "#6b7280"},
}

MUSIC_PROFILES = {
    "happy":    {"scale": "major",      "bpm": 128, "root": 60, "reverb": 0.2, "brightness": 0.85},
    "sad":      {"scale": "minor",      "bpm": 58,  "root": 57, "reverb": 0.7, "brightness": 0.25},
    "angry":    {"scale": "phrygian",   "bpm": 150, "root": 52, "reverb": 0.1, "brightness": 0.9},
    "fear":     {"scale": "diminished", "bpm": 90,  "root": 55, "reverb": 0.8, "brightness": 0.3},
    "surprise": {"scale": "lydian",     "bpm": 140, "root": 64, "reverb": 0.3, "brightness": 0.9},
    "disgust":  {"scale": "locrian",    "bpm": 75,  "root": 53, "reverb": 0.5, "brightness": 0.2},
    "neutral":  {"scale": "pentatonic", "bpm": 90,  "root": 60, "reverb": 0.4, "brightness": 0.5},
}

SHIFT_TARGET = {
    "angry":    "neutral",
    "fear":     "neutral",
    "disgust":  "neutral",
    "sad":      "neutral",
    "surprise": "happy",
    "happy":    "happy",
    "neutral":  "happy",
}


def _run_deepface(frame: np.ndarray) -> dict:
    """
    Runs DeepFace synchronously — called inside a thread pool
    so it never blocks the async event loop.
    """
    try:
        result = DeepFace.analyze(
            frame,
            actions=["emotion"],
            enforce_detection=False,
            silent=True,
        )
        emotions = result[0]["emotion"]
        dominant = max(emotions, key=emotions.get)
        confidence = emotions[dominant] / 100.0
        region = result[0].get("region", {})
        return {
            "ok": True,
            "emotion": dominant,
            "confidence": round(confidence, 3),
            "all_emotions": {k: round(v / 100, 3) for k, v in emotions.items()},
            "face_box": region,
        }
    except Exception as e:
        return {
            "ok": False,
            "emotion": "neutral",
            "confidence": 0.0,
            "all_emotions": {},
            "face_box": {},
            "error": str(e),
        }


def _decode_frame(b64_data: str) -> np.ndarray | None:
    """Decode base64 JPEG → numpy BGR array."""
    try:
        # Strip data-URL prefix if present
        if "," in b64_data:
            b64_data = b64_data.split(",")[1]
        img_bytes = base64.b64decode(b64_data)
        np_arr = np.frombuffer(img_bytes, np.uint8)
        return cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
    except Exception:
        return None


@app.get("/", response_class=HTMLResponse)
async def root():
    with open("templates/index.html", encoding="utf-8") as f:
        return f.read()


@app.websocket("/ws/emotion")
async def emotion_ws(ws: WebSocket):
    await ws.accept()
    shift_mode = False
    frame_count = 0
    loop = asyncio.get_event_loop()

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            # ── Shift mode toggle ────────────────────────────────────────────
            if msg.get("type") == "shift_toggle":
                shift_mode = msg.get("value", False)
                await ws.send_text(json.dumps({
                    "type": "shift_ack",
                    "shift_mode": shift_mode
                }))
                continue

            # ── Frame analysis ───────────────────────────────────────────────
            if msg.get("type") == "frame":
                frame_count += 1
                # Analyse every 3rd frame → ~1 analysis/sec at 300ms capture rate
                if frame_count % 3 != 0:
                    continue

                frame = _decode_frame(msg["data"])
                if frame is None:
                    continue

                # ✅ Run DeepFace in thread pool — non-blocking
                df_result = await loop.run_in_executor(
                    _executor, _run_deepface, frame
                )

                emotion = df_result["emotion"]
                meta    = EMOTION_MAP.get(emotion, EMOTION_MAP["neutral"])
                music   = MUSIC_PROFILES.get(emotion, MUSIC_PROFILES["neutral"])

                payload = {
                    "type":        "emotion",
                    "emotion":     emotion,
                    "confidence":  df_result["confidence"],
                    "all_emotions":df_result["all_emotions"],
                    "face_box":    df_result["face_box"],
                    "meta":        meta,
                    "music":       music,
                    "timestamp":   time.time(),
                }

                if shift_mode:
                    target = SHIFT_TARGET.get(emotion, "neutral")
                    payload["shifted_music"] = MUSIC_PROFILES[target]
                    payload["shift_label"]   = EMOTION_MAP[target]["label"]

                if not df_result["ok"]:
                    payload["warning"] = df_result.get("error", "")

                await ws.send_text(json.dumps(payload))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await ws.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass



"""from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
import cv2
import numpy as np
import base64
import json
import asyncio
from deepface import DeepFace
import librosa
import sounddevice as sd
import threading
import queue
import time

app = FastAPI(title="MoodMorph")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

# ── Russell Circumplex: map DeepFace emotion → valence/arousal ──────────────
EMOTION_MAP = {
    "happy":   {"valence": 0.9,  "arousal": 0.7,  "label": "Happy",    "emoji": "😊", "color": "#f59e0b"},
    "sad":     {"valence": 0.15, "arousal": 0.2,  "label": "Sad",      "emoji": "😢", "color": "#3b82f6"},
    "angry":   {"valence": 0.1,  "arousal": 0.95, "label": "Angry",    "emoji": "😠", "color": "#ef4444"},
    "fear":    {"valence": 0.1,  "arousal": 0.9,  "label": "Anxious",  "emoji": "😰", "color": "#8b5cf6"},
    "surprise":{"valence": 0.7,  "arousal": 0.85, "label": "Surprised","emoji": "😲", "color": "#06b6d4"},
    "disgust": {"valence": 0.1,  "arousal": 0.6,  "label": "Disgusted","emoji": "🤢", "color": "#84cc16"},
    "neutral": {"valence": 0.5,  "arousal": 0.4,  "label": "Neutral",  "emoji": "😐", "color": "#6b7280"},
}

# ── Music profiles per mood (Web Audio API params sent to frontend) ──────────
MUSIC_PROFILES = {
    "happy":    {"scale": "major",       "bpm": 128, "root": 60, "reverb": 0.2, "brightness": 0.85},
    "sad":      {"scale": "minor",       "bpm": 58,  "root": 57, "reverb": 0.7, "brightness": 0.25},
    "angry":    {"scale": "phrygian",    "bpm": 150, "root": 52, "reverb": 0.1, "brightness": 0.9},
    "fear":     {"scale": "diminished",  "bpm": 90,  "root": 55, "reverb": 0.8, "brightness": 0.3},
    "surprise": {"scale": "lydian",      "bpm": 140, "root": 64, "reverb": 0.3, "brightness": 0.9},
    "disgust":  {"scale": "locrian",     "bpm": 75,  "root": 53, "reverb": 0.5, "brightness": 0.2},
    "neutral":  {"scale": "pentatonic",  "bpm": 90,  "root": 60, "reverb": 0.4, "brightness": 0.5},
}

SHIFT_TARGET = {
    "angry":   "neutral",
    "fear":    "neutral",
    "disgust": "neutral",
    "sad":     "neutral",
    "surprise":"happy",
    "happy":   "happy",
    "neutral": "happy",
}


def analyze_frame(frame_b64: str) -> dict:
    ""Decode base64 frame and run DeepFace emotion analysis.""
    img_bytes = base64.b64decode(frame_b64.split(",")[1])
    np_arr = np.frombuffer(img_bytes, np.uint8)
    frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)

    try:
        result = DeepFace.analyze(
            frame,
            actions=["emotion"],
            enforce_detection=False,
            silent=True,
        )
        emotions = result[0]["emotion"]
        dominant = max(emotions, key=emotions.get)
        confidence = emotions[dominant] / 100.0
        region = result[0].get("region", {})
        return {
            "emotion": dominant,
            "confidence": round(confidence, 3),
            "all_emotions": {k: round(v / 100, 3) for k, v in emotions.items()},
            "face_box": region,
            "meta": EMOTION_MAP.get(dominant, EMOTION_MAP["neutral"]),
            "music": MUSIC_PROFILES.get(dominant, MUSIC_PROFILES["neutral"]),
        }
    except Exception as e:
        return {
            "emotion": "neutral",
            "confidence": 0.0,
            "all_emotions": {},
            "face_box": {},
            "meta": EMOTION_MAP["neutral"],
            "music": MUSIC_PROFILES["neutral"],
            "error": str(e),
        }


@app.get("/", response_class=HTMLResponse)
async def root():
    with open("templates/index.html") as f:
        return f.read()


@app.websocket("/ws/emotion")
async def emotion_ws(ws: WebSocket):
    await ws.accept()
    shift_mode = False
    frame_count = 0

    try:
        while True:
            data = await ws.receive_text()
            msg = json.loads(data)

            if msg.get("type") == "shift_toggle":
                shift_mode = msg.get("value", False)
                await ws.send_text(json.dumps({"type": "shift_ack", "shift_mode": shift_mode}))
                continue

            if msg.get("type") == "frame":
                frame_count += 1
                # Analyze every 3rd frame to reduce CPU load
                if frame_count % 3 != 0:
                    continue

                result = analyze_frame(msg["data"])
                emotion = result["emotion"]

                if shift_mode:
                    target = SHIFT_TARGET.get(emotion, "neutral")
                    result["shifted_music"] = MUSIC_PROFILES[target]
                    result["shift_label"] = EMOTION_MAP[target]["label"]

                result["type"] = "emotion"
                result["timestamp"] = time.time()
                await ws.send_text(json.dumps(result))

    except WebSocketDisconnect:
        pass
    except Exception as e:
        await ws.send_text(json.dumps({"type": "error", "message": str(e)}))"""
