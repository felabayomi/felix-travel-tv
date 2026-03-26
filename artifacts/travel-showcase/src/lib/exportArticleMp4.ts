const WIDTH = 1280;
const HEIGHT = 720;
const SECONDS_PER_CHAPTER = 5;

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
  const W = WIDTH;
  const H = HEIGHT;

  ctx.fillStyle = '#050508';
  ctx.fillRect(0, 0, W, H);

  if (img) {
    ctx.save();
    ctx.globalAlpha = 0.25;
    const scale = Math.max(W / img.naturalWidth, H / img.naturalHeight);
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    ctx.restore();

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(5,5,8,0.85)');
    grad.addColorStop(0.4, 'rgba(5,5,8,0.6)');
    grad.addColorStop(1, 'rgba(5,5,8,0.95)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);
  }

  ctx.fillStyle = RED;
  ctx.fillRect(0, 0, 6, H);

  ctx.fillStyle = 'rgba(200,16,46,0.92)';
  ctx.fillRect(6, 0, W - 6, 58);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 20px Arial';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText(article.source.toUpperCase(), 26, 29);

  ctx.textAlign = 'right';
  ctx.font = '16px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText(`CHAPTER ${chapterIndex + 1} OF ${totalChapters}`, W - 20, 29);
  ctx.textAlign = 'left';

  const dateStr = new Date(article.publishedAt).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric',
  });
  ctx.textAlign = 'right';
  ctx.font = '13px Arial';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(dateStr, W - 20, 46);
  ctx.textAlign = 'left';

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 54px Arial';
  ctx.textBaseline = 'top';
  const headlineBottom = wrapText(ctx, snippet.headline.toUpperCase(), 26, 90, W - 52, 64, 2);

  ctx.fillStyle = RED;
  ctx.fillRect(26, headlineBottom + 14, 60, 3);

  ctx.fillStyle = 'rgba(220,220,220,0.92)';
  ctx.font = '24px Arial';
  const captionBottom = wrapText(ctx, snippet.caption, 26, headlineBottom + 34, W - 52, 32, 2);

  ctx.fillStyle = 'rgba(160,160,160,0.85)';
  ctx.font = '18px Arial';
  wrapText(ctx, snippet.explanation, 26, captionBottom + 16, W - 52, 26, 3);

  ctx.fillStyle = RED;
  ctx.fillRect(6, H - 50, W - 6, 50);

  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = '15px Arial';
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  let titleText = article.title;
  while (ctx.measureText(titleText + '…').width > W - 52 && titleText.length > 0) {
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
  // Pre-load all images
  const images = await Promise.all(
    snippets.map(s => s.imageUrl ? loadImage(s.imageUrl) : Promise.resolve(null))
  );

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;

  // Pick best supported MIME type
  const mimeType = [
    'video/mp4;codecs=h264',
    'video/mp4',
    'video/webm;codecs=h264',
    'video/webm;codecs=vp9',
    'video/webm',
  ].find(t => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';

  const stream = canvas.captureStream(1);
  const recorder = new MediaRecorder(stream, {
    mimeType,
    videoBitsPerSecond: 2_000_000,
  });

  const chunks: Blob[] = [];
  recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

  const stopped = new Promise<void>(resolve => {
    recorder.onstop = () => resolve();
  });

  recorder.start(200);

  for (let i = 0; i < snippets.length; i++) {
    drawSlide(ctx, article, snippets[i], i, snippets.length, images[i]);
    onProgress?.(Math.round((i / snippets.length) * 95));

    // Hold this slide for SECONDS_PER_CHAPTER seconds
    await new Promise(r => setTimeout(r, SECONDS_PER_CHAPTER * 1000));
  }

  recorder.stop();
  await stopped;
  onProgress?.(100);

  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
  const blob = new Blob(chunks, { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const safeName = article.title.replace(/[^a-z0-9]/gi, '_').slice(0, 60);
  a.download = `${safeName}.${ext}`;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
