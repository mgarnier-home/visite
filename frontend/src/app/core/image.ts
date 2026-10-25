/** Dimensions réduites pour que le grand côté ne dépasse pas `max` (jamais agrandies). */
export function fitWithin(w: number, h: number, max = 2000): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(w, h));
  return { width: Math.round(w * scale), height: Math.round(h * scale) };
}

/** Redimensionne (2000 px max) et recompresse en JPEG qualité 0,8. */
export async function compressImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = fitWithin(bitmap.width, bitmap.height);
    let blob: Blob | null;
    if (typeof OffscreenCanvas !== 'undefined') {
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    } else {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height);
      blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.8));
    }
    if (!blob) throw new Error('Compression de la photo impossible : le navigateur n\'a produit aucune image');
    return blob;
  } finally {
    bitmap.close();
  }
}
