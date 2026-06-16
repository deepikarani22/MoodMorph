/**
 * MoodMorph WebSocket Controller
 * Handles webcam capture, WebSocket communication, and UI state.
 */

class MoodMorphApp {
  constructor() {
    this.ws = null;
    this.videoEl = document.getElementById("video");
    this.canvasEl = document.getElementById("canvas");
    this.visCanvas = document.getElementById("visualizer");
    this.ctx2d = this.canvasEl.getContext("2d");
    this.visCtx = this.visCanvas.getContext("2d");

    this.audio = new MoodMorphAudio();
    this.isRunning = false;
    this.shiftMode = false;
    this.currentEmotion = null;
    this.captureInterval = null;
    this.visFrame = null;
    this.history = [];

    this.MOOD_COLORS = {
      happy:    "#f59e0b",
      sad:      "#3b82f6",
      angry:    "#ef4444",
      fear:     "#8b5cf6",
      surprise: "#06b6d4",
      disgust:  "#84cc16",
      neutral:  "#6b7280",
    };

    this._bindUI();
  }

  _bindUI() {
    document.getElementById("btn-start").addEventListener("click", () => this.start());
    document.getElementById("btn-stop").addEventListener("click", () => this.stop());
    document.getElementById("btn-shift").addEventListener("click", () => this.toggleShift());
    document.getElementById("vol-slider").addEventListener("input", (e) => {
      this.audio.setVolume(parseFloat(e.target.value));
    });
  }

  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      this.videoEl.srcObject = stream;
      await new Promise(r => this.videoEl.onloadedmetadata = r);
      this.videoEl.play();

      this._connectWS();
      document.getElementById("btn-start").disabled = true;
      document.getElementById("btn-stop").disabled = false;
      document.getElementById("btn-shift").disabled = false;
      document.getElementById("status").textContent = "Detecting emotion...";
      this.isRunning = true;
      this._startVisualizer();
    } catch (e) {
      this._showError("Camera access denied: " + e.message);
    }
  }

  _connectWS() {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    this.ws = new WebSocket(`${proto}://${location.host}/ws/emotion`);

    this.ws.onopen = () => {
      console.log("WS connected");
      this.captureInterval = setInterval(() => this._captureFrame(), 300);
    };

    this.ws.onmessage = (evt) => {
      const data = JSON.parse(evt.data);
      if (data.type === "emotion") this._handleEmotion(data);
      if (data.type === "error") this._showError(data.message);
    };

    this.ws.onclose = () => {
      console.log("WS disconnected");
      clearInterval(this.captureInterval);
    };
  }

  _captureFrame() {
    if (!this.videoEl.videoWidth) return;
    this.canvasEl.width = 320;
    this.canvasEl.height = 240;
    this.ctx2d.drawImage(this.videoEl, 0, 0, 320, 240);
    const b64 = this.canvasEl.toDataURL("image/jpeg", 0.7);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "frame", data: b64 }));
    }
  }

  _handleEmotion(data) {
    const { emotion, confidence, meta, music, shifted_music, shift_label, all_emotions } = data;
    this.currentEmotion = emotion;

    // Update UI
    document.getElementById("emotion-label").textContent = `${meta.emoji} ${meta.label}`;
    document.getElementById("emotion-label").style.color = meta.color;
    document.getElementById("confidence-bar").style.width = `${Math.round(confidence * 100)}%`;
    document.getElementById("confidence-val").textContent = `${Math.round(confidence * 100)}%`;

    const activeProfile = this.shiftMode && shifted_music ? shifted_music : music;
    activeProfile._emotion = this.shiftMode && shifted_music ? (shift_label || "neutral").toLowerCase() : emotion;

    document.getElementById("music-info").textContent =
      `${activeProfile.scale} · ${activeProfile.bpm} BPM · root ${activeProfile.root}`;

    if (this.shiftMode && shifted_music) {
      document.getElementById("shift-label").textContent = `Shifting → ${shift_label}`;
      document.getElementById("shift-label").style.display = "block";
    } else {
      document.getElementById("shift-label").style.display = "none";
    }

    // Update emotion bars
    this._updateEmotionBars(all_emotions);

    // Update audio
    if (!this.audio.isPlaying) {
      this.audio.play(activeProfile);
    } else {
      this.audio.updateProfile(activeProfile);
    }

    // History
    this._addHistory(meta, confidence);

    // Update visualizer color
    this._currentColor = meta.color;
  }

  _updateEmotionBars(emotions) {
    const container = document.getElementById("emotion-bars");
    if (!container || !emotions) return;
    container.innerHTML = "";
    const sorted = Object.entries(emotions).sort((a, b) => b[1] - a[1]);
    sorted.forEach(([emo, val]) => {
      const pct = Math.round(val * 100);
      const color = this.MOOD_COLORS[emo] || "#6b7280";
      const bar = document.createElement("div");
      bar.className = "emo-bar-row";
      bar.innerHTML = `
        <span class="emo-name">${emo}</span>
        <div class="emo-track">
          <div class="emo-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <span class="emo-pct">${pct}%</span>`;
      container.appendChild(bar);
    });
  }

  _addHistory(meta, confidence) {
    const now = new Date().toLocaleTimeString();
    this.history.unshift({ label: meta.label, emoji: meta.emoji, color: meta.color, confidence, time: now });
    if (this.history.length > 5) this.history.pop();

    const el = document.getElementById("history-list");
    if (!el) return;
    el.innerHTML = this.history.map(h => `
      <div class="hist-item">
        <span style="color:${h.color}">${h.emoji} ${h.label}</span>
        <span class="hist-time">${h.time}</span>
      </div>`).join("");
  }

  toggleShift() {
    this.shiftMode = !this.shiftMode;
    const btn = document.getElementById("btn-shift");
    btn.textContent = this.shiftMode ? "⬆ Shift ON" : "⬆ Shift Mood";
    btn.classList.toggle("shift-active", this.shiftMode);
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: "shift_toggle", value: this.shiftMode }));
    }
  }

  stop() {
    this.isRunning = false;
    clearInterval(this.captureInterval);
    if (this.ws) this.ws.close();
    if (this.videoEl.srcObject) {
      this.videoEl.srcObject.getTracks().forEach(t => t.stop());
    }
    this.audio.stop();
    cancelAnimationFrame(this.visFrame);
    document.getElementById("btn-start").disabled = false;
    document.getElementById("btn-stop").disabled = true;
    document.getElementById("btn-shift").disabled = true;
    document.getElementById("status").textContent = "Stopped.";
    document.getElementById("emotion-label").textContent = "—";
    document.getElementById("shift-label").style.display = "none";
  }

  _startVisualizer() {
    const draw = () => {
      this.visFrame = requestAnimationFrame(draw);
      const W = this.visCanvas.width;
      const H = this.visCanvas.height;
      const data = this.audio.getVisualizerData();
      const color = this._currentColor || "#a78bfa";

      this.visCtx.fillStyle = "rgba(13,13,20,0.4)";
      this.visCtx.fillRect(0, 0, W, H);

      if (!data) return;

      // Draw frequency bars
      const barW = W / data.length * 2.5;
      data.forEach((val, i) => {
        const barH = (val / 255) * H * 0.8;
        const x = i * (barW + 1);
        const alpha = 0.5 + (val / 255) * 0.5;
        this.visCtx.fillStyle = color + Math.round(alpha * 255).toString(16).padStart(2, "0");
        this.visCtx.fillRect(x, H - barH, barW, barH);
      });

      // Central pulse ring
      const avg = data.reduce((a, b) => a + b, 0) / data.length;
      const radius = 30 + (avg / 255) * 50;
      this.visCtx.beginPath();
      this.visCtx.arc(W / 2, H / 2, radius, 0, Math.PI * 2);
      this.visCtx.strokeStyle = color;
      this.visCtx.lineWidth = 2;
      this.visCtx.globalAlpha = avg / 255;
      this.visCtx.stroke();
      this.visCtx.globalAlpha = 1;
    };
    draw();
  }

  _showError(msg) {
    document.getElementById("status").textContent = "Error: " + msg;
    document.getElementById("status").style.color = "#ef4444";
  }
}

window.addEventListener("DOMContentLoaded", () => {
  window.app = new MoodMorphApp();
});
