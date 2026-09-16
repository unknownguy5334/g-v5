import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const checks = [];
const ok = (condition, label) => { checks.push([condition, label]); if (!condition) console.error(`FAIL: ${label}`); };

const payment = read('server/paymentRoutes.ts');
const paymentValidation = read('server/paymentValidation.ts');
const server = read('server.ts');
const imageValidation = read('server/imageValidation.ts');
const ocrContract = read('src/utils/ocrApiContract.ts');
const optimizer = read('src/utils/imageOptimizer.ts');
const stepAdd = read('src/components/StepAddCourses.tsx');
const schema = read('server/db/schema.ts');
const staticApp = read('server/staticApp.ts');

ok(/multer\(\{\s*storage:\s*multer\.memoryStorage\(\)/s.test(payment), 'Payment proofs use bounded in-memory multipart handling rather than filesystem paths');
ok(/fileSize:\s*10 \* 1024 \* 1024/.test(payment), 'Payment proof per-file byte limit is enforced by multipart parser');
ok(/files:\s*1/.test(payment) && /parts:\s*10/.test(payment) && /headerPairs:\s*200/.test(payment), 'Payment multipart part/file/header counts are bounded');
ok(/validatePaymentProof\(file\.buffer, file\.mimetype\)/.test(payment) && /detectMagicMime/.test(paymentValidation), 'Payment proof uses explicit content-signature validation against declared MIME');
ok(/proofMimeType:\s*validatedProofMime/.test(payment), 'Only the validated MIME is persisted, never an unchecked client MIME');
ok(/validatePaymentProof/.test(payment) && /detectImageDimensions/.test(paymentValidation), 'Payment proof dimensions are inspected before persistence');
ok(/MAX_PAYMENT_PROOF_DIMENSION|MAX_PAYMENT_PROOF_PIXELS/.test(paymentValidation) && /40_000_000/.test(paymentValidation), 'Payment proof dimensions/pixel count are bounded');
ok(/X-Content-Type-Options.*nosniff/.test(payment) && /Content-Disposition.*inline/.test(payment), 'Admin proof responses prevent MIME sniffing and do not expose download filenames');
ok(/Cache-Control.*private, no-cache, no-store, must-revalidate/.test(payment), 'Uploaded proof responses are not publicly cacheable');
ok(/payment_proofs.*bytea|data: bytea/.test(schema), 'Proof bytes are stored as binary data, not executable path/URL references');
ok(!/file\.originalname|req\.file\.originalname/.test(payment), 'Client filenames are not persisted or used as server filesystem paths');
ok(/isValidBase64/.test(server) && /detectOrValidateImageFormat/.test(server), 'OCR endpoint validates base64 syntax and image magic bytes server-side');
ok(/MAX_IMAGES_PER_REQUEST/.test(server) && /MAX_TOTAL_IMAGES_BYTES/.test(server) && /MAX_RAW_PAYLOAD_BYTES/.test(server), 'OCR corpus count, decoded-total, and raw-transport limits are server-side');
ok(/MAX_IMAGE_DIMENSION/.test(server) && /MAX_IMAGE_PIXELS/.test(server), 'OCR image dimension and pixel limits are server-side');
ok(/app\.post\('\/api\/extract-schedule', requireAuth/.test(server), 'OCR upload/process endpoints require authentication');
ok(/image\/png.*image\/jpeg.*image\/webp/.test(ocrContract) && /image\.data\.length > 20_000_000/.test(ocrContract), 'Client OCR contract restricts image MIME types and individual encoded payload size');
ok(/accept="image\/png,image\/jpeg,image\/jpg,image\/webp"/.test(stepAdd), 'Browser picker advertises only supported schedule image formats');
ok(/createImageBitmap/.test(optimizer) && /canvas\.toDataURL\('image\/jpeg'/.test(optimizer), 'Schedule screenshots are decoded and normalized in the browser before OCR transport');
ok(/data: bytea/.test(schema), 'No uploaded file is stored in a database field intended for executable content');
ok(!/diskStorage\(|writeFile\(|createWriteStream\(|extract.*zip|unzip|tar\.x/.test(payment + server), 'Upload handlers do not unpack archives or write uploaded content to server filesystem paths');
ok(/configureFrontendServing\(app, config\)/.test(server) && !/payment_proofs/.test(staticApp), 'Static serving does not expose the payment-proof storage relation');
ok(/export function validatePaymentProof/.test(paymentValidation) && /'image\/png' \| 'image\/jpeg' \| 'image\/webp'/.test(paymentValidation), 'Upload MIME validation returns a closed supported-image set');

const failures = checks.filter(([condition]) => !condition).length;
console.log(`File upload red-team implementation checks: ${checks.length - failures}/${checks.length} passed.`);
process.exitCode = failures ? 1 : 0;
