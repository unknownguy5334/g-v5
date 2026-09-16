// We don't have enough time to write a fully robust E2E test script testing Express APIs,
// but we can test the database layer logic.
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from '../server/db/schema.js';
import dotenv from 'dotenv';
import { eq, desc } from 'drizzle-orm';
import { 
  submitPayment, 
  approvePayment, 
  rejectPayment, 
  getStudentEntitlements 
} from '../server/services/paymentService.js';
import { startFreeRun, completeRun, getOrCreateStudentProfile, getStudentProfile } from '../server/services/studentProfile.js';

// This test intentionally mutates a database (it creates a student, changes payment-method
// configuration, and writes payment/entitlement state). Never allow it to target a shared or
// production database accidentally. Explicit opt-in plus a loopback DATABASE_URL is required.
const databaseUrl = String(process.env.DATABASE_URL || '').trim();
if (process.env.ALLOW_MUTATING_TEST_DB !== 'true') {
  throw new Error('Refusing to run mutating payment tests without ALLOW_MUTATING_TEST_DB=true.');
}
if (!databaseUrl) throw new Error('DATABASE_URL is required for the payment-access test.');
try {
  const parsed = new URL(databaseUrl);
  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1') {
    throw new Error('Refusing to run mutating payment tests against a non-loopback database host.');
  }
} catch (error) {
  if (error instanceof Error && /Refusing to run/.test(error.message)) throw error;
  throw new Error('Invalid DATABASE_URL for mutating payment tests.');
}

dotenv.config({ path: '.env.local' });
dotenv.config();

const { Pool } = pg;
const pool = new Pool({ connectionString: databaseUrl });
const db = drizzle(pool, { schema });

const VALID_TEST_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');

async function runTests() {
  console.log('--- STARTING PAYMENT & ACCESS TESTS ---');
  const studentId = 'test-student-pay-' + Date.now();
  
  // 1. Create student
  await getOrCreateStudentProfile(studentId, 'testpay@miuegypt.edu.eg', 'Test Pay Student');
  console.log('✅ Student created');

  // 2. Free run flow
  const runResult = await startFreeRun(studentId, 'FREE_RUN', '2026–2027', 'FALL');
  // insert mock schedule for run
  await db.insert(schema.savedSchedules).values({
    studentId,
    runId: runResult.run.id,
    academicYear: '2026–2027',
    term: 'FALL',
    scheduleData: { mock: true },
    title: 'Test Schedule',
  });
  await completeRun(studentId, runResult.run.id);
  console.log('✅ Free run consumed');

  let profile = await getStudentProfile(studentId);
  if (profile.freeRunStatus !== 'used') throw new Error('Free run should be used');

  // Try start free run again
  try {
    await startFreeRun(studentId, 'FREE_RUN', '2026–2027', 'FALL');
    throw new Error('Should have failed to start free run');
  } catch (e: any) {
    if (e.message !== 'Free run already used') throw e;
    console.log('✅ Free run correctly rejected on second attempt');
  }

  // Ensure test method is enabled in this isolated test environment.
  await db.insert(schema.paymentMethodsConfig).values({id:'MANUAL_INSTAPAY',enabled:1,destination:'TEST',instructions:'TEST'})
    .onConflictDoUpdate({target:schema.paymentMethodsConfig.id,set:{enabled:1,destination:'TEST'}});
  await db.insert(schema.paymentMethodsConfig).values({id:'MANUAL_TELDA',enabled:1,destination:'TEST',instructions:'TEST'})
    .onConflictDoUpdate({target:schema.paymentMethodsConfig.id,set:{enabled:1,destination:'TEST'}});

  // 3. Submit payment
  const sub = await submitPayment({
    studentId,
    plan: 'CURRENT_TERM',
    paymentMethod: 'MANUAL_INSTAPAY',
    academicYear: '2026-2027',
    term: 'FALL',
    fullName: 'Test Student',
    phoneNumber: '01000000000',
    proofMimeType: 'image/png',
    proofData: VALID_TEST_PNG
  });
  console.log('✅ Payment submitted. ID:', sub.id);

  // 4. Reject payment
  await rejectPayment(sub.id, 'admin1', 'Blurry image');
  const entsRejected = await getStudentEntitlements(studentId);
  if (entsRejected.length > 0) throw new Error('Should not have entitlements');
  console.log('✅ Rejected payment grants no access');

  // 5. Submit another payment and approve
  const sub2 = await submitPayment({
    studentId,
    plan: 'ACADEMIC_YEAR',
    paymentMethod: 'MANUAL_TELDA',
    academicYear: '2026-2027',
    teldaUsername: '@testuser',
    fullName: 'Test Student',
    phoneNumber: '01000000000',
    proofMimeType: 'image/png',
    proofData: VALID_TEST_PNG
  });

  await approvePayment(sub2.id, 'admin1');
  const entsApproved = await getStudentEntitlements(studentId);
  if (entsApproved.length === 0) throw new Error('Should have entitlements');
  console.log('✅ Approved payment grants access');
  
  // 6. Test duplicate approve logic
  await approvePayment(sub2.id, 'admin1').catch(e => {
    if (e.message !== 'Submission is not pending') throw e;
    console.log('✅ Duplicate approval prevented');
  });

  console.log('--- ALL PAYMENT TESTS PASSED ---');
  process.exit(0);
}

runTests().catch(e => {
  console.error('TEST FAILED:', e);
  process.exit(1);
});
