/** Small deterministic PCM fixtures, decoded and seeked by the real browser. */
export function tone(seconds: number): string {
  const count = Math.round(8000 * seconds);
  const bytes = new ArrayBuffer(44 + count * 2);
  const view = new DataView(bytes);
  const text = (at: number, value: string) =>
    [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));
  text(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 8000, true);
  view.setUint32(28, 16000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++)
    view.setInt16(44 + i * 2, Math.sin((i * 2 * Math.PI * 220) / 8000) * 1000, true);
  const url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  return url;
}
