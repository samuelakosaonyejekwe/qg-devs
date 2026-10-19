/**
 * Video capture of animations (MediaRecorder on a canvas stream). The caller supplies a draw function that
 * paints the current frame into a 2-D context (the 3-D composite or a chart painter); each animation frame
 * is drawn into an offscreen canvas whose stream is recorded as WebM (or MP4 where the browser supports it).
 */
export function videoSupported(): boolean {
  return typeof MediaRecorder !== 'undefined' && typeof HTMLCanvasElement !== 'undefined' && 'captureStream' in HTMLCanvasElement.prototype;
}

function pickType(): string {
  const c = ['video/mp4;codecs=avc1', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  return c.find((t) => MediaRecorder.isTypeSupported?.(t)) ?? 'video/webm';
}

export interface Recording { stop(): Promise<{ blob: Blob; ext: string }>; }

export function startRecording(draw: (ctx: CanvasRenderingContext2D, scale: number) => void, w: number, h: number, fps: 30 | 60 = 30, scale = 1): Recording {
  const c = document.createElement('canvas');
  c.width = Math.round(w * scale); c.height = Math.round(h * scale);
  const ctx = c.getContext('2d')!;
  const stream = (c as any).captureStream(fps) as MediaStream;
  const type = pickType();
  const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  let live = true;
  const loop = () => { if (!live) return; ctx.clearRect(0, 0, c.width, c.height); draw(ctx, scale); requestAnimationFrame(loop); };
  loop();
  rec.start(250);
  return {
    stop: () => new Promise((res) => {
      live = false;
      rec.onstop = () => { stream.getTracks().forEach((t) => t.stop()); res({ blob: new Blob(chunks, { type }), ext: type.includes('mp4') ? 'mp4' : 'webm' }); };
      rec.stop();
    }),
  };
}

export function saveBlob(b: Blob, name: string) {
  const u = URL.createObjectURL(b);
  const a = document.createElement('a');
  a.href = u; a.download = name; a.rel = 'external';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(u), 4000);
}
