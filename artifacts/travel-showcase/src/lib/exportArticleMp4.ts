import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

const WIDTH = 1280;
const HEIGHT = 720;
const FPS = 30;
const SECONDS_PER_CHAPTER = 8;
const FRAMES_PER_CHAPTER = FPS * SECONDS_PER_CHAPTER;

export interface ExportSnippet {
  id: number;
  headline: string;
  caption: string;
  explanation: string;
  imageUrl: string | null;
}

export interface ExportArticle {
  title: string;
  source: string;
  publishedAt: string;
}

async function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
    setTimeout(() => resolve(null), 8000);
  });
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines = 3
): number {
  const words = text.split(' ');
  let line = '';
  let linesDrawn = 0;

  for (let i = 0; i < words.length; i++) {
    const test = line + (line ? ' ' : '') + words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + linesDrawn * lineHeight);
      linesDrawn++;
      if (linesDrawn >= maxLines) {
        // Truncate with ellipsis
        let ellipsis = words.slice(i).join(' ');
        while (ctx.measureText(ellipsis + '…').width > maxWidth && ellipsis.length > 0) {
          ellipsis = ellipsis.slice(0, -1);
        }
        ctx.fillText(ellipsis + '…', x, y + linesDrawn * lineHeight);
        linesDrawn++;
        return y + linesDrawn * lineHeight;
      }
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) {
    ctx.fillText(line, x, y + linesDrawn * lineHeight);
    linesDrawn++;
  }
  return y + linesDrawn * lineHeight;
}

function drawSlide(
  ctx: CanvasRenderingContext2D,
  article: ExportArticle,
  snippet: ExportSnippet,
  chapterIndex: number,
  totalChapters: number,
  img: HTMLImageElement | null
) {
  const RED = '#c8102e';
  const BG = '#050508';
  const W = WIDTH;
  const H = HEIGHT;

  // Background
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);

  // Background image with dark overlay
  if (img) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();

    // Gradient overlay
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(5,5,8,0.85)');
    grad.addColorStop(0.4, 'rgba(5,5,8,0.6)');
    grad.addColorStop(1, 'rgba(5,5,8,0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  // Left red accent bar
  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, 6, H);

  // Top header bar
  ctx.fillStyle = 'rgba(200,16,46,0.92)';
  ctx.fillRect(6, 0, W - 6, 58);

  // Source name
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px "Oswald", "Arial Narrow", sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(article.source.toUpperCase(), 26, 29);

  // Chapter counter (right)
  ctx.textAlign = 'right';
  ctx.font = '16px "IBM Plex Sans", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`CHAPTER ${chapterIndex + 1} OF ${totalChapters}`, W - 20, 29);
  ctx.textAlign = 'left';

  // Date (right, below counter)
  const dateStr = new Date(article.publishedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  ctx.textAlign = 'right';
  ctx.font = '13px "IBM Plex Sans", Arial, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(dateStr, W - 20, 46);
  ctx.textAlign = 'left';

  // Headline
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px "Oswald", "Arial Narrow", sans-serif';
  ctx.textBaseline = 'top';
  const headlineBottom = wrapText(ctx, snippet.headline.toUpperCase(), 26, 90, W - 52, 64, 2);

  // Thin red separator
  ctx.fillStyle = RED;
  ctx.fillRect(26, headlineBottom + 14, 60, 3);

  // Caption
  ctx.fillStyle = 'rgba(220,220,220,0.92)';
  ctx.font = '24px "IBM Plex Sans", Arial, sans-serif';
  const captionBottom = wrapText(ctx, snippet.caption, 26, headlineBottom + 34, W - 52, 32, 2);

  // Explanation
  ctx.fillStyle = 'rgba(160,160,160,0.85)';
  ctx.font = '18px "IBM Plex Sans", Arial, sans-serif';
  wrapText(ctx, snippet.explanation, 26, captionBottom + 16, W - 52, 26, 3);

  // Bottom bar
  ctx.fillStyle = RED;
  ctx.fillRect(6, H - 50, W - 6, 50);

  // Article title in bottom bar
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '15px "IBM Plex Sans", Arial, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  // Truncate article title if too long
  let titleText = article.title;
  const maxTitleWidth = W - 52;
  while (ctx.measureText(titleText + '…').width > maxTitleWidth && titleText.length > 0) {
    titleText = titleText.slice(0, -1);
  }
  if (titleText !== article.title) titleText += '…';
  ctx.fillText(titleText, 26, H - 25);
}

export async function exportArticleToMp4(
  article: ExportArticle,
  snippets: ExportSnippet[],
  onProgress?: (pct: number) => void
): Promise<void> {
  // Load fonts
  try {
    await Promise.all([
      document.fonts.load('bold 54px "Oswald"'),
      document.fonts.load('18px "IBM Plex Sans"'),
    ]);
  } catch {
    // Fonts may not be loaded — fallback to system fonts, still works
  }

  // Pre-load all images
  const images = await Promise.all(
    snippets.map(s => s.imageUrl ? loadImage(s.imageUrl) : Promise.resolve(null))
  );

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: 'avc', width: WIDTH, height: HEIGHT },
    fastStart: 'in-memory',
  });

  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: e => console.error('VideoEncoder error:', e),
  });

  encoder.configure({
    codec: 'avc1.4d0028',
    width: WIDTH,
    height: HEIGHT,
    bitrate: 5_000_000,
    framerate: FPS,
  });

  const totalFrames = snippets.length * FRAMES_PER_CHAPTER;
  let frameIndex = 0;

  for (let si = 0; si < snippets.length; si++) {
    drawSlide(ctx, article, snippets[si], si, snippets.length, images[si]);

    for (let f = 0; f < FRAMES_PER_CHAPTER; f++) {
      const timestampMicros = Math.round((frameIndex / FPS) * 1_000_000);
      const frame = new VideoFrame(canvas, { timestamp: timestampMicros });
      encoder.encode(frame, { keyFrame: f === 0 });
      frame.close();
      frameIndex++;

      if (f === 0) {
        onProgress?.(Math.round((si / snippets.length) * 100));
        // Yield to browser so UI stays responsive
        await new Promise(r => setTimeout(r, 0));
      }
    }
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  onProgress?.(100);

  const buffer = target.buffer;
  const blob = new Blob([buffer], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = article.title.replace(/[^a-z0-9]/gi, '_').slice(0, 60);
  a.download = `${safeName}.mp4`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
