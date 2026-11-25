export type MusicScene = 'waiting' | 'playing' | 'finale';

export const musicTempo: Record<MusicScene, number> = { waiting: 86, playing: 124, finale: 148 };
const waitingMelody = [
  62, 0, 63, 66, 67, 0, 66, 63, 62, 0, 57, 62, 69, 0, 70, 69,
  67, 0, 66, 67, 69, 0, 73, 74, 70, 69, 67, 66, 63, 0, 62, 0,
];
const playingMelody = [
  69, 0, 74, 77, 76, 74, 72, 0, 67, 69, 72, 74, 77, 76, 74, 0,
  74, 76, 77, 81, 79, 77, 76, 74, 72, 74, 69, 72, 67, 0, 69, 0,
];
const playBass = [50, 46, 48, 45];

interface Voices {
  string: (note: number, beats: number, strength: number) => void;
  sustained: (note: number, beats: number, strength: number) => void;
  drum: (low: boolean, strength: number) => void;
}

export function scoreStep(scene: MusicScene, step: number, voices: Voices) {
  const pulse = step % 8;
  if (scene === 'waiting') {
    const note = waitingMelody[step % waitingMelody.length];
    if (note) voices.string(note, pulse % 2 === 0 ? 2.1 : 1.4, .48);
    if (pulse === 0) {
      voices.sustained(38, 7.2, .29);
      voices.sustained(45, 7.2, .16);
      voices.drum(true, .40);
    }
    if (pulse === 3 || pulse === 6) voices.drum(false, .29);
    return;
  }
  const note = playingMelody[step % playingMelody.length];
  const bass = playBass[Math.floor(step / 8) % playBass.length];
  if (note) voices.string(note, 1.5, .53);
  if (pulse % 2 === 0) voices.sustained(bass + (pulse === 6 ? 7 : 0), 1.45, .38);
  if (pulse === 0 || pulse === 4 || (scene === 'finale' && pulse === 6)) voices.drum(true, .65);
  if (pulse === 2 || pulse === 5 || pulse === 7 || (scene === 'finale' && pulse === 3)) voices.drum(false, .45);
  if (scene === 'finale' && pulse === 7) voices.string(bass + 24, .8, .40);
}
