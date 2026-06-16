"""
MoodMorph launcher — run this file to start the server.
  python run.py
"""
import subprocess, sys, os

os.chdir(os.path.dirname(os.path.abspath(__file__)))

print("""
╔══════════════════════════════════════════╗
║   MoodMorph — Emotion-Adaptive Music     ║
║   Starting on http://localhost:8001      ║
╚══════════════════════════════════════════╝
""")

subprocess.run([
    sys.executable, "-m", "uvicorn",
    "app:app",
    "--host", "0.0.0.0",
    "--port", "8001",
    "--reload"
])
