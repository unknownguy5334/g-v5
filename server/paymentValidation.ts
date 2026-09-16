import { detectImageDimensions } from './imageValidation';

export const MAX_PAYMENT_PROOF_BYTES = 10 * 1024 * 1024;
export const MAX_PAYMENT_PROOF_DIMENSION = 8000;
export const MAX_PAYMENT_PROOF_PIXELS = 40_000_000;

export type ValidatedPaymentProofMime = 'image/png' | 'image/jpeg' | 'image/webp';

function detectMagicMime(buffer: Buffer): ValidatedPaymentProofMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export function validatePaymentProof(buffer: Buffer, declaredMime: string): ValidatedPaymentProofMime {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_PAYMENT_PROOF_BYTES) {
    throw new Error('Payment proof must be a non-empty image within the size limit.');
  }

  const magicMime = detectMagicMime(buffer);
  if (!magicMime || magicMime !== declaredMime) {
    throw new Error('Payment proof must be a valid PNG, JPEG, or WebP image.');
  }

  const dimensions = detectImageDimensions(buffer.toString('base64'), magicMime, buffer.length);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1 || dimensions.width > MAX_PAYMENT_PROOF_DIMENSION || dimensions.height > MAX_PAYMENT_PROOF_DIMENSION || dimensions.width * dimensions.height > MAX_PAYMENT_PROOF_PIXELS) {
    throw new Error('Payment proof image dimensions are invalid or too large.');
  }

  return magicMime;
}
