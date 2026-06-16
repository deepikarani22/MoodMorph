/**
 * MoodMorph Audio Engine
 * Generates real-time music using Web Audio API based on mood profiles.
 * No external libraries, no API keys, runs entirely in the browser.
 */

class MoodMorphAudio {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.reverbNode = null;
    this.oscillators = [];
    this.schedulerTimer = null;
    this.isPlaying = false;
    this.currentProfile = null;
    this.nextNoteTime = 0;
    this.stepIndex = 0;
    this.analyser = null;
    this.dataArray = null;

    // Scale definitions as semitone intervals from root
    this.SCALES = {
      major:       [0, 2, 4, 5, 7, 9, 11, 12],
      minor:       [0, 2, 3, 5, 7, 8, 10, 12],
      pentatonic:  [0, 2, 4, 7, 9, 12],
      phrygian:    [0, 1, 3, 5, 7, 8, 10, 12],
      lydian:      [0, 2, 4, 6, 7, 9, 11, 12],
      diminished:  [0, 2, 3, 5, 6, 8, 9, 11, 12],
      locrian:     [0, 1, 3, 5, 6, 8, 10, 12],
    };

    // Rhythmic patterns per mood (1=note, 0=rest)
    this.PATTERNS = {
      happy:    [1, 0, 1, 1, 0, 1, 0, 1],
      sad:      [1, 0, 0, 0, 1, 0, 0, 0],
      angry:    [1, 1, 0, 1, 1, 0, 1, 1],
      fear:     [1, 0, 0, 1, 0, 1, 0, 0],
      surprise: [1, 1, 1, 0, 1, 0, 1, 1],
      disgust:  [1, 0, 1, 0, 0, 1, 0, 0],
      neutral:  [1, 0, 0, 1, 0, 0, 1, 0],
    };

    // Chord voicings (scale degree indices for chord tones)
    this.CHORDS = {
      happy:    [[0,2,4],[1,3,5],[2,4,6],[0,2,4]],
      sad:      [[0,2,4],[5,0,2],[3,5,0],[4,6,1]],
      angry:    [[0,1,4],[0,3,6],[0,2,5],[0,1,3]],
      fear:     [[0,3,6],[2,5,1],[4,0,3],[1,4,7]],
      surprise: [[0,2,4,6],[1,3,5,0],[2,4,6,1],[3,5,0,2]],
      disgust:  [[0,2,5],[1,4,6],[2,5,0],[3,6,1]],
      neutral:  [[0,2,4],[2,4,6],[4,6,1],[6,1,3]],
    };
  }

  async init() {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(0.0, this.ctx.currentTime);

    // Analyser for visualizer
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.dataArray = new Uint8Array(this.analyser.frequencyBinCount);

    // Reverb via convolver
    this.reverbNode = await this._buildReverb(2.5);

    // Chain: masterGain → analyser → reverb → destination
    this.masterGain.connect(this.analyser);
    this.analyser.connect(this.reverbNode);
    this.reverbNode.connect(this.ctx.destination);
  }

  /** Build a simple reverb using a noise impulse response */
  async _buildReverb(duration) {
    const sampleRate = this.ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = this.ctx.createBuffer(2, length, sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.5);
      }
    }
    const convolver = this.ctx.createConvolver();
    convolver.buffer = impulse;
    // Dry/wet mix
    const dry = this.ctx.createGain();
    const wet = this.ctx.createGain();
    dry.gain.value = 0.7;
    wet.gain.value = 0.3;
    const merger = this.ctx.createGain();
    this.masterGain.connect(dry);
    dry.connect(merger);
    convolver.connect(wet);
    wet.connect(merger);
    return convolver; // We'll connect masterGain → convolver separately
  }

  midiToFreq(midi) {
    return 440 * Math.pow(2, (midi - 69) / 12);
  }

  getScaleFreqs(profile) {
    const scale = this.SCALES[profile.scale] || this.SCALES.pentatonic;
    const root = profile.root || 60;
    return scale.map(interval => this.midiToFreq(root + interval));
  }

  /** Schedule notes ahead of time (lookahead scheduler pattern) */
  _scheduleNote(freq, time, duration, waveType = "sine", gainVal = 0.15) {
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = waveType;
    osc.frequency.setValueAtTime(freq, time);

    // Slight detune for warmth
    osc.detune.setValueAtTime((Math.random() - 0.5) * 8, time);

    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(gainVal, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.001, time + duration - 0.02);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + duration);
  }

  _scheduleChord(profile, time) {
    const freqs = this.getScaleFreqs(profile);
    const emotion = profile._emotion || "neutral";
    const chordSet = this.CHORDS[emotion] || this.CHORDS.neutral;
    const chord = chordSet[Math.floor(this.stepIndex / 2) % chordSet.length];
    const duration = (60 / profile.bpm) * 2;

    chord.forEach((degree, i) => {
      const freq = freqs[degree % freqs.length];
      // Arpeggiate slightly for texture
      this._scheduleNote(
        i === 0 ? freq / 2 : freq,
        time + i * 0.04,
        duration,
        i === 0 ? "triangle" : "sine",
        i === 0 ? 0.18 : 0.10
      );
    });
  }

  _scheduleMelody(profile, time) {
    const freqs = this.getScaleFreqs(profile);
    const emotion = profile._emotion || "neutral";
    const pattern = this.PATTERNS[emotion] || this.PATTERNS.neutral;
    const beat = 60 / profile.bpm;

    pattern.forEach((hit, i) => {
      if (hit) {
        const freq = freqs[Math.floor(Math.random() * freqs.length)] * 2; // octave up
        this._scheduleNote(freq, time + i * beat * 0.5, beat * 0.4, "sine", 0.08);
      }
    });
  }

  _scheduleBass(profile, time) {
    const freqs = this.getScaleFreqs(profile);
    const beat = 60 / profile.bpm;
    const bassFreq = freqs[0] / 2;
    this._scheduleNote(bassFreq, time, beat * 1.8, "triangle", 0.2);
  }

  _tick(profile) {
    const lookAhead = 0.1; // seconds
    const scheduleAhead = 0.25;

    while (this.nextNoteTime < this.ctx.currentTime + scheduleAhead) {
      const beat = 60 / profile.bpm;
      const barTime = beat * 8;

      if (this.stepIndex % 8 === 0) this._scheduleChord(profile, this.nextNoteTime);
      if (this.stepIndex % 4 === 0) this._scheduleBass(profile, this.nextNoteTime);
      this._scheduleMelody(profile, this.nextNoteTime);

      this.nextNoteTime += beat;
      this.stepIndex++;
    }
  }

  async play(profile) {
    if (!this.ctx) await this.init();
    if (this.ctx.state === "suspended") await this.ctx.resume();

    this.stop(false);
    this.currentProfile = { ...profile };
    this.isPlaying = true;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    this.stepIndex = 0;

    // Fade in
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.setValueAtTime(0, this.ctx.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(0.8, this.ctx.currentTime + 1.5);

    // Set reverb wetness
    const reverbAmount = profile.reverb || 0.4;
    // (already mixed at construction; reverbAmount stored for display)

    this.schedulerTimer = setInterval(() => {
      if (this.isPlaying) this._tick(this.currentProfile);
    }, 50);
  }

  updateProfile(profile) {
    if (!this.isPlaying) return;
    // Smooth transition: blend BPM gradually
    if (this.currentProfile) {
      this.currentProfile = { ...profile };
    }
  }

  stop(fade = true) {
    clearInterval(this.schedulerTimer);
    this.isPlaying = false;
    if (this.masterGain && fade) {
      this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
      this.masterGain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.2);
    }
  }

  getVisualizerData() {
    if (!this.analyser) return null;
    this.analyser.getByteFrequencyData(this.dataArray);
    return this.dataArray;
  }

  setVolume(val) {
    if (this.masterGain) {
      this.masterGain.gain.linearRampToValueAtTime(val, this.ctx.currentTime + 0.1);
    }
  }
}

window.MoodMorphAudio = MoodMorphAudio;
