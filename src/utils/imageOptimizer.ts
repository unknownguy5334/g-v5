/**
 * Ultra-Fast Client-side Image Preprocessing & Compression
 * Downscales camera screenshots and portal grabs to optimal 1800px width with 0.88 JPEG quality.
 * Uses hardware-accelerated createImageBitmap where available for instant sub-50ms decoding.
 */

import { IMAGE_OPTIMIZATION_POLICY as POLICY } from './imageOptimizationPolicy';

const LOW_RESOLUTION_MAX_DIM = POLICY.lowResolutionMaxDimension;

export function isSupportedScheduleImage(file: File | Blob | { type?: string; name?: string }): boolean {
  if (!file) return false;
  const mimeType = (file.type || '').toLowerCase();
  if (['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(mimeType)) {
    return true;
  }
  const name = ('name' in file && typeof file.name === 'string' ? file.name : '').toLowerCase();
  return /\.(png|jpe?g|webp)$/i.test(name);
}

export async function optimizeImageForOCR(file: File): Promise<{ base64: string; mimeType: string; warning?: string }> {
  // Fast path: Hardware-accelerated bitmap decoding (if supported by browser/webview)
  if (typeof window !== 'undefined' && typeof window.createImageBitmap === 'function') {
    try {
      const bitmap = await window.createImageBitmap(file);
      const MAX_DIM = POLICY.maxDimension;
      let width = bitmap.width;
      let height = bitmap.height;

      const warning = (bitmap.width < LOW_RESOLUTION_MAX_DIM && bitmap.height < LOW_RESOLUTION_MAX_DIM)
        ? `This image is very low resolution (${bitmap.width}×${bitmap.height}). A higher-resolution screenshot is recommended for reliable OCR.`
        : undefined;

      if (width > MAX_DIM || height > MAX_DIM) {
        if (width > height) {
          height = Math.round((height * MAX_DIM) / width);
          width = MAX_DIM;
        } else {
          width = Math.round((width * MAX_DIM) / height);
          height = MAX_DIM;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d', { alpha: false });
      if (ctx) {
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(bitmap, 0, 0, width, height);
        bitmap.close();

        return {
          base64: canvas.toDataURL('image/jpeg', POLICY.jpegQuality),
          mimeType: 'image/jpeg',
          warning,
        };
      }
      bitmap.close();
    } catch {
      // Fall through to FileReader if bitmap decoding fails
    }
  }

  // Fallback path: standard FileReader + HTMLImageElement
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const MAX_DIM = 1800;
        let { width, height } = img;

        const warning = (img.width < LOW_RESOLUTION_MAX_DIM && img.height < LOW_RESOLUTION_MAX_DIM)
          ? `This image is very low resolution (${img.width}×${img.height}). A higher-resolution screenshot is recommended for reliable OCR.`
          : undefined;

        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round((height * MAX_DIM) / width);
            width = MAX_DIM;
          } else {
            width = Math.round((width * MAX_DIM) / height);
            height = MAX_DIM;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          resolve({ base64: reader.result as string, mimeType: file.type || 'image/jpeg', warning });
          return;
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.88);
        resolve({
          base64: compressedDataUrl,
          mimeType: 'image/jpeg',
          warning,
        });
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

