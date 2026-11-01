/**
 * Bereitet ein Bild als YouTube-Thumbnail vor: 1280×720 (16:9, mittig zugeschnitten), JPEG, max. 2 MB.
 * Fremde Bild-URLs werden über den Server geladen, damit das Canvas sie lesen darf.
 */
const WIDTH = 1280;
const HEIGHT = 720;
const MAX_BYTES = 2 * 1024 * 1024;

export const proxiedImageUrl = (url: string) => `/api/livestreams/image?url=${encodeURIComponent(url)}`;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Das Bild konnte nicht geladen werden'));
    img.src = src;
  });
}

export async function toThumbnail(source: Blob | string): Promise<Blob> {
  const src = typeof source === 'string' ? proxiedImageUrl(source) : URL.createObjectURL(source);
  try {
    const img = await loadImage(src);
    const canvas = document.createElement('canvas');
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const ctx = canvas.getContext('2d')!;
    const scale = Math.max(WIDTH / img.naturalWidth, HEIGHT / img.naturalHeight);
    const w = img.naturalWidth * scale;
    const h = img.naturalHeight * scale;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    ctx.drawImage(img, (WIDTH - w) / 2, (HEIGHT - h) / 2, w, h);
    for (const quality of [0.9, 0.8, 0.7, 0.6]) {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
      if (blob && blob.size <= MAX_BYTES) return blob;
    }
    throw new Error('Das Bild ist zu gross');
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(src);
  }
}
