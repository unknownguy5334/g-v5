import { eq, desc, and, isNull } from 'drizzle-orm';
import { getDb, getDbPool } from '../db';
import { paymentSubmissions, paymentProofs, entitlements, paymentMethodsConfig, products, students } from '../db/schema';
import { logActivity } from './studentProfile';
import { getCurrentAcademicContext } from './academicContext';
import { resolvePurchaseContext } from './purePolicies';
import { readTtlCache, writeTtlCache, type TtlCacheEntry } from '../perfCache';
import { createNotification } from './notificationService';
import { validatePaymentProof } from '../paymentValidation';

export class PaymentServiceError extends Error {
  constructor(message: string, public readonly status = 400, public readonly code = 'PAYMENT_ERROR') { super(message); this.name = 'PaymentServiceError'; }
}
const inputError = (m:string) => new PaymentServiceError(m,400,'INVALID_INPUT');
const unavailableError = () => new PaymentServiceError('Payment service is temporarily unavailable. Please try again later.',503,'PAYMENT_UNAVAILABLE');
const notFoundError = (m:string) => new PaymentServiceError(m,404,'NOT_FOUND');
const conflictError = (m:string) => new PaymentServiceError(m,409,'CONFLICT');

const SUPPORTED_PLANS = new Set(['CURRENT_TERM', 'ACADEMIC_YEAR']);
const SUPPORTED_PAYMENT_METHODS = new Set(['MANUAL_INSTAPAY', 'MANUAL_TELDA', 'MANUAL_VODAFONE_CASH']);
const CONFIG_CACHE_TTL_MS = 10_000;
let productsCache: TtlCacheEntry<any[]> | null = null;
let methodsCache: TtlCacheEntry<any[]> | null = null;

export function invalidatePaymentConfigCache(): void {
  productsCache = null;
  methodsCache = null;
}

export async function getProducts(includeDisabled = true) {
  const cached = readTtlCache(productsCache);
  if (cached) return includeDisabled ? cached : cached.filter((product: any) => product.enabled === 1);
  const db = getDb();
  if (!db) throw unavailableError();
  const rows = await db.select({ id: products.id, name: products.name, amount: products.amount, currency: products.currency, enabled: products.enabled, version: products.version }).from(products).orderBy(products.id);
  if (!rows.length) throw new PaymentServiceError('No products are configured.',503,'PRODUCTS_UNAVAILABLE');
  productsCache = writeTtlCache(rows, CONFIG_CACHE_TTL_MS);
  return includeDisabled ? rows : rows.filter((product: any) => product.enabled === 1);
}

export async function getPaymentMethods(includeDisabled = true) {
  const cached = readTtlCache(methodsCache);
  if (cached) return includeDisabled ? cached : cached.filter((method: any) => method.enabled === 1 && String(method.destination || '').trim());
  const db = getDb();
  if (!db) throw unavailableError();
  const rows = await db.select({ id: paymentMethodsConfig.id, enabled: paymentMethodsConfig.enabled, destination: paymentMethodsConfig.destination, instructions: paymentMethodsConfig.instructions, updatedAt: paymentMethodsConfig.updatedAt }).from(paymentMethodsConfig).orderBy(paymentMethodsConfig.id);
  methodsCache = writeTtlCache(rows, CONFIG_CACHE_TTL_MS);
  return includeDisabled ? rows : rows.filter((method: any) => method.enabled === 1 && String(method.destination || '').trim());
}

export async function submitPayment(data: {
  studentId: string; plan: string; paymentMethod: string; clientRequestId?: string; academicYear: string; term?: string;
  fullName: string; phoneNumber: string; teldaUsername?: string; proofMimeType: string; proofData: Buffer;
}) {
  const db = getDb();
  if (!db) throw unavailableError();

  if (!SUPPORTED_PLANS.has(data.plan)) throw inputError('Selected product is invalid.');
  if (!SUPPORTED_PAYMENT_METHODS.has(data.paymentMethod)) throw inputError('Selected payment method is invalid.');
  try {
    const validatedProofMime = validatePaymentProof(data.proofData, data.proofMimeType);
    data.proofMimeType = validatedProofMime;
  } catch {
    throw inputError('Payment proof is invalid.');
  }

  const productRows = await db.select().from(products).where(and(eq(products.id, data.plan), eq(products.enabled, 1))).limit(1);
  const product = productRows[0];
  if (!product) throw notFoundError('Selected product is unavailable.');
  const currentContext = await getCurrentAcademicContext();
  const hasActiveAy = (await db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.studentId, data.studentId), eq(entitlements.plan, 'ACADEMIC_YEAR'), eq(entitlements.status, 'ACTIVE'), eq(entitlements.academicYear, currentContext.academicYear))).limit(1)).length > 0;
  const hasActiveTerm = (await db.select({ id: entitlements.id }).from(entitlements).where(and(eq(entitlements.studentId, data.studentId), eq(entitlements.plan, 'CURRENT_TERM'), eq(entitlements.status, 'ACTIVE'), eq(entitlements.academicYear, currentContext.academicYear), eq(entitlements.term, currentContext.term))).limit(1)).length > 0;
  if (data.plan === 'ACADEMIC_YEAR' && hasActiveAy) throw conflictError('You already have active Academic Year access.');
  if (data.plan === 'CURRENT_TERM' && (hasActiveAy || hasActiveTerm)) throw conflictError('You already have active access for this period.');
  const amount = product.amount;
  let payableAmount = amount;
  const purchaseContext = resolvePurchaseContext(data.plan as 'CURRENT_TERM' | 'ACADEMIC_YEAR', currentContext);
  const authoritativeAcademicYear = purchaseContext.academicYear;
  const authoritativeTerm = purchaseContext.term;
  if (data.plan === 'ACADEMIC_YEAR' && hasActiveTerm) {
    const termEntitlement = (await db.select({ amountPaid: entitlements.amountPaid }).from(entitlements).where(and(eq(entitlements.studentId, data.studentId), eq(entitlements.plan, 'CURRENT_TERM'), eq(entitlements.status, 'ACTIVE'), eq(entitlements.academicYear, currentContext.academicYear), eq(entitlements.term, currentContext.term))).orderBy(desc(entitlements.createdAt)).limit(1))[0];
    const termProduct = (await db.select({ amount: products.amount }).from(products).where(and(eq(products.id, 'CURRENT_TERM'), eq(products.enabled, 1))).limit(1))[0];
    const alreadyPaid = Number(termEntitlement?.amountPaid || 0) > 0 ? Number(termEntitlement.amountPaid) : Number(termProduct?.amount || 0);
    if (!termProduct || !Number.isFinite(alreadyPaid) || product.amount <= alreadyPaid) throw new PaymentServiceError('The Academic Year upgrade is temporarily unavailable at the current configured prices.', 503, 'UPGRADE_UNAVAILABLE');
    payableAmount = product.amount - alreadyPaid;
  }
  if (!authoritativeAcademicYear || (data.plan === 'CURRENT_TERM' && !['FALL','SPRING','SUMMER'].includes(authoritativeTerm || ''))) {
    throw new Error('The current academic access period is unavailable. Please try again later.');
  }

  const methodRows = await db.select().from(paymentMethodsConfig)
    .where(and(eq(paymentMethodsConfig.id, data.paymentMethod), eq(paymentMethodsConfig.enabled, 1))).limit(1);
  const method = methodRows[0];
  if (!method) throw notFoundError('Selected payment method is unavailable.');
  if (!method.destination.trim()) throw new PaymentServiceError('This payment method is not fully configured yet. Please choose another method or contact support.',503,'PAYMENT_METHOD_UNAVAILABLE');

  
  if (data.paymentMethod === 'MANUAL_TELDA' && !data.teldaUsername?.trim()) throw inputError('Telda username is required.');
  if (data.paymentMethod !== 'MANUAL_TELDA' && data.teldaUsername) throw inputError('Telda username is only used for Telda.');
  if (!/^\+?[0-9 ()-]{8,20}$/.test(data.phoneNumber.trim())) throw inputError('Please provide a valid phone number.');
  if (!data.fullName.trim() || data.fullName.trim().length > 120 || /[\u0000-\u001F\u007F]/.test(data.fullName)) throw inputError('Please provide a valid full name.');
  if (data.phoneNumber.trim().length > 20) throw inputError('Please provide a valid phone number.');
  if (data.paymentMethod === 'MANUAL_TELDA' && (!data.teldaUsername || data.teldaUsername.trim().length > 100 || /[\u0000-\u001F\u007F]/.test(data.teldaUsername))) throw inputError('Please provide a valid Telda username.');
  if (data.clientRequestId && (!/^[A-Za-z0-9._:-]{8,120}$/.test(data.clientRequestId))) throw inputError('Invalid payment submission identifier.');

  if (data.clientRequestId) {
    const existingRequest = await db.select().from(paymentSubmissions).where(and(
      eq(paymentSubmissions.studentId, data.studentId),
      eq(paymentSubmissions.clientRequestId, data.clientRequestId)
    )).limit(1);
    if (existingRequest.length) return existingRequest[0];
  }

  const existingPending = await db.select().from(paymentSubmissions).where(and(
    eq(paymentSubmissions.studentId, data.studentId),
    eq(paymentSubmissions.plan, data.plan),
    eq(paymentSubmissions.academicYear, authoritativeAcademicYear),
    data.plan === 'CURRENT_TERM' ? eq(paymentSubmissions.term, authoritativeTerm!) : isNull(paymentSubmissions.term),
    eq(paymentSubmissions.status, 'PENDING')
  ));
  if (existingPending.length > 0) throw conflictError('You already have a pending payment for this access period.');

  // Keep payment + proof insertion atomic.
  const pool = getDbPool();
  if (!pool) throw unavailableError();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const subResult = await client.query(
      `INSERT INTO payment_submissions
        (student_id, plan, amount, product_name_snapshot, product_version, payment_method, client_request_id, academic_year, term, full_name, phone_number, telda_username, payment_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'PENDING')
       RETURNING *`,
      [data.studentId, data.plan, payableAmount, product.name, product.version, data.paymentMethod, data.clientRequestId || null, authoritativeAcademicYear,
       authoritativeTerm, data.fullName.trim(), data.phoneNumber.trim(),
       data.paymentMethod === 'MANUAL_TELDA' ? data.teldaUsername?.trim() || null : null]
    );
    const submission = subResult.rows[0];
    const proofResult = await client.query(
      `INSERT INTO payment_proofs (submission_id, mime_type, data) VALUES ($1,$2,$3) RETURNING *`,
      [submission.id, data.proofMimeType, data.proofData]
    );
    await client.query(`UPDATE payment_submissions SET proof_id=$1, updated_at=NOW() WHERE id=$2`, [proofResult.rows[0].id, submission.id]);
    await client.query('COMMIT');
    await logActivity(data.studentId, 'PAYMENT_SUBMITTED', { submissionId: submission.id, plan: data.plan, paymentMethod: data.paymentMethod });
    await createNotification(data.studentId, 'INFO', 'Payment submitted', `Your ${product.name} payment is pending verification.`);
    return submission;
  } catch (e: any) {
    await client.query('ROLLBACK');
    const constraint = String(e?.constraint || '');
    if (e?.code === '23505' && constraint.includes('payment_client_request_unique') && data.clientRequestId) {
      const existingRequest = await db.select().from(paymentSubmissions).where(and(
        eq(paymentSubmissions.studentId, data.studentId),
        eq(paymentSubmissions.clientRequestId, data.clientRequestId)
      )).limit(1);
      if (existingRequest.length) return existingRequest[0];
    }
    if (e?.code === '23505' && constraint.includes('payment_pending_scope_unique')) {
      throw new Error('You already have a pending payment for this access period.');
    }
    throw e;
  } finally {
    client.release();
  }
}

export async function getStudentSubmissions(studentId: string) {
  const db = getDb(); if (!db) throw unavailableError();
  return await db.select({
    id: paymentSubmissions.id, plan: paymentSubmissions.plan, amount: paymentSubmissions.amount,
    paymentMethod: paymentSubmissions.paymentMethod, academicYear: paymentSubmissions.academicYear,
    term: paymentSubmissions.term, productNameSnapshot: paymentSubmissions.productNameSnapshot, productVersion: paymentSubmissions.productVersion, status: paymentSubmissions.status, rejectionReason: paymentSubmissions.rejectionReason,
    createdAt: paymentSubmissions.createdAt, updatedAt: paymentSubmissions.updatedAt
  }).from(paymentSubmissions).where(eq(paymentSubmissions.studentId, studentId)).orderBy(desc(paymentSubmissions.createdAt)).limit(100);
}

export async function getStudentEntitlements(studentId: string) {
  const db = getDb(); if (!db) throw unavailableError();
  return await db.select().from(entitlements).where(eq(entitlements.studentId, studentId)).orderBy(desc(entitlements.createdAt)).limit(100);
}

export async function getPendingSubmissions() {
  const db = getDb(); if (!db) throw unavailableError();
  return await db.select({ submission: paymentSubmissions, studentEmail: students.email, studentDisplayName: students.displayName })
    .from(paymentSubmissions).leftJoin(students, eq(paymentSubmissions.studentId, students.id))
    .where(eq(paymentSubmissions.status, 'PENDING')).orderBy(desc(paymentSubmissions.createdAt)).limit(100);
}
export async function getAllSubmissions(statusFilter?: string) {
  const db = getDb(); if (!db) throw unavailableError();
  const query = db.select({ submission: paymentSubmissions, studentEmail: students.email, studentDisplayName: students.displayName })
    .from(paymentSubmissions).leftJoin(students, eq(paymentSubmissions.studentId, students.id));
  const q = statusFilter && statusFilter !== 'ALL' ? query.where(eq(paymentSubmissions.status, statusFilter as any)) : query;
  return await q.orderBy(desc(paymentSubmissions.createdAt)).limit(500);
}
export async function getProof(submissionId: string) {
  const db = getDb(); if (!db) throw unavailableError();
  const rows = await db.select({ id: paymentProofs.id, mimeType: paymentProofs.mimeType, data: paymentProofs.data, createdAt: paymentProofs.createdAt }).from(paymentProofs).where(eq(paymentProofs.submissionId, submissionId)).limit(1);
  return rows[0] || null;
}

export async function approvePayment(submissionId: string, adminId: string) {
  const pool = getDbPool();
  if (!pool) throw unavailableError();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const subResult = await client.query(`
      SELECT ps.*, pp.id AS proof_id
      FROM payment_submissions ps
      LEFT JOIN payment_proofs pp ON pp.id = ps.proof_id AND pp.submission_id = ps.id
      WHERE ps.id=$1
      FOR UPDATE`, [submissionId]);
    const sub = subResult.rows[0];
    if (!sub) throw new Error('Submission not found');
    if (sub.payment_status !== 'PENDING') throw new Error('Submission is not pending');
    if (!sub.proof_id) throw new PaymentServiceError('A valid payment proof is required before approval.', 409, 'PAYMENT_PROOF_REQUIRED');

    const existing = await client.query(
      `SELECT id FROM entitlements WHERE student_id=$1 AND plan=$2 AND academic_year=$3 AND COALESCE(term,'_')=COALESCE($4,'_') AND status='ACTIVE' FOR UPDATE`,
      [sub.student_id, sub.plan, sub.academic_year, sub.term]
    );
    if (existing.rows.length) {
      await client.query(`UPDATE payment_submissions SET payment_status='APPROVED', reviewed_by=$1, reviewed_at=NOW(), updated_at=NOW() WHERE id=$2`, [adminId, submissionId]);
    } else {
      await client.query(`UPDATE payment_submissions SET payment_status='APPROVED', reviewed_by=$1, reviewed_at=NOW(), updated_at=NOW() WHERE id=$2`, [adminId, submissionId]);
      try {
        await client.query(
          `INSERT INTO entitlements (student_id, plan, academic_year, term, status, product_name_snapshot, amount_paid, currency, product_version, submission_id)
           VALUES ($1,$2,$3,$4,'ACTIVE',$5,$6,$7,$8,$9)`,
          [sub.student_id, sub.plan, sub.academic_year, sub.term, sub.product_name_snapshot || (sub.plan === 'CURRENT_TERM' ? 'Current Term' : 'Academic Year'), sub.amount, 'EGP', sub.product_version || 1, submissionId]
        );
      } catch (insertError: any) {
        // A concurrent approval may have created the same entitlement.
        // The database uniqueness constraint is authoritative; treat that race as success.
        if (insertError?.code !== '23505' || !String(insertError?.constraint || '').includes('entitlements_active_scope_unique')) throw insertError;
      }
    }
    await client.query(
      `INSERT INTO activity_audit (student_id, event_type, metadata) VALUES ($1, $2, $3::jsonb)`,
      [sub.student_id, 'PAYMENT_APPROVED', JSON.stringify({ submissionId, reviewedBy: adminId })],
    );
    await client.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [adminId, 'PAYMENT_APPROVED', 'PAYMENT_SUBMISSION', submissionId, JSON.stringify({ studentId: sub.student_id })],
    );
    await client.query('COMMIT');
    try { await createNotification(sub.student_id, 'SUCCESS', 'Payment approved', `${sub.product_name_snapshot || sub.plan} access is now active.`); } catch {}
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}


export async function cancelPaymentSubmission(studentId: string, submissionId: string) {
  const pool = getDbPool();
  if (!pool) throw unavailableError();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(
      `UPDATE payment_submissions
       SET payment_status='CANCELLED', updated_at=NOW(), rejection_reason=NULL, reviewed_at=NULL, reviewed_by=NULL
       WHERE id=$1 AND student_id=$2 AND payment_status='PENDING'
       RETURNING *`,
      [submissionId, studentId],
    );
    if (!result.rows.length) throw new Error('Payment submission not found or no longer pending.');
    await client.query(
      `INSERT INTO activity_audit (student_id, event_type, metadata) VALUES ($1,$2,$3::jsonb)`,
      [studentId, 'PAYMENT_CANCELLED', JSON.stringify({ submissionId })],
    );
    await client.query('COMMIT');
    try { await createNotification(studentId, 'INFO', 'Payment cancelled', 'Your pending payment submission was cancelled.'); } catch {}
    return result.rows[0];
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function getAdminEntitlements() {
  const db = getDb(); if (!db) throw unavailableError();
  return await db.select({
    entitlement: entitlements,
    studentEmail: students.email,
    studentDisplayName: students.displayName,
  }).from(entitlements).leftJoin(students, eq(entitlements.studentId, students.id)).orderBy(desc(entitlements.createdAt)).limit(500);
}

export async function revokeEntitlement(entitlementId: string, adminId: string, reason: string) {
  const pool = getDbPool();
  if (!pool) throw unavailableError();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM entitlements WHERE id=$1 FOR UPDATE', [entitlementId]);
    const entitlement = result.rows[0];
    if (!entitlement) throw new Error('Entitlement not found');
    if (entitlement.status !== 'ACTIVE') throw new Error('Entitlement is already inactive.');
    await client.query(
      `UPDATE entitlements SET status='REVOKED', revoked_at=NOW(), revoked_by=$1, revoke_reason=$2 WHERE id=$3`,
      [adminId, reason.trim(), entitlementId]
    );
    await client.query(
      `INSERT INTO activity_audit (student_id, event_type, metadata) VALUES ($1,$2,$3::jsonb)`,
      [entitlement.student_id, 'ENTITLEMENT_REVOKED', JSON.stringify({ entitlementId, revokedBy: adminId, reason: reason.trim() })],
    );
    await client.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [adminId, 'ENTITLEMENT_REVOKED', 'ENTITLEMENT', entitlementId, JSON.stringify({ studentId: entitlement.student_id, reason: reason.trim() })],
    );
    await client.query('COMMIT');
    return { ...entitlement, status: 'REVOKED' };
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}

export async function rejectPayment(submissionId: string, adminId: string, reason: string) {
  const pool = getDbPool();
  if (!pool) throw unavailableError();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const res = await client.query(
      `UPDATE payment_submissions
       SET payment_status='REJECTED', rejection_reason=$1, reviewed_by=$2, reviewed_at=NOW(), updated_at=NOW()
       WHERE id=$3 AND payment_status='PENDING'
       RETURNING *`,
      [reason.trim(), adminId, submissionId],
    );
    if (!res.rows.length) throw new Error('Submission not found or no longer pending');
    const submission = res.rows[0];
    await client.query(
      `INSERT INTO activity_audit (student_id, event_type, metadata) VALUES ($1,$2,$3::jsonb)`,
      [submission.student_id, 'PAYMENT_REJECTED', JSON.stringify({ submissionId, reviewedBy: adminId })],
    );
    await client.query(
      `INSERT INTO admin_audit_log (admin_id, action, target_type, target_id, metadata) VALUES ($1,$2,$3,$4,$5::jsonb)`,
      [adminId, 'PAYMENT_REJECTED', 'PAYMENT_SUBMISSION', submissionId, JSON.stringify({ studentId: submission.student_id })],
    );
    await client.query('COMMIT');
    try { await createNotification(submission.student_id, 'WARNING', 'Payment rejected', submission.rejection_reason || 'Your payment could not be verified.'); } catch {}
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch {}
    throw e;
  } finally {
    client.release();
  }
}
