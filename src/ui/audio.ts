/**
 * Engine sound — thin shim. The physically based synth lives in src/audio
 * (DSP core in src/audio/synth, AudioWorklet in src/audio/worklet.ts, live
 * wiring in src/audio/live.ts). Kept here so Header.tsx's import is unchanged.
 */
export { setAudioEnabled, disposeAudio } from '../audio/live';
