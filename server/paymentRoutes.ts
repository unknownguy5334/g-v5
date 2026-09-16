import express, { Request, Response } from 'express';
import multer from 'multer';
import { 
  getPaymentMethods, 
  submitPayment, 
  getStudentSubmissions, 
  getStudentEntitlements,
  getPendingSubmissions,
  getAllSubmissions,
  getProof,
  approvePayment,
  rejectPayment,
  getAdminEntitlements,
  revokeEntitlement,
  cancelPaymentSubmission,
  getProducts,
  invalidatePaymentConfigCache,
  PaymentServiceError
} from './services/paymentService';
import { getCurrentAcademicContext } from './services/academicContext';
import { getAccessState } from './services/accessService';
import { requireAuth, requireAdmin } from './authMiddleware';
import { allowPersistentRateLimit } from './persistentRateLimiter';
import { persistentRateLimitMiddleware } from './rateLimitMiddleware';
import { getDb } from './db';
import { paymentMethodsConfig, appConfig, products, adminAuditLog } from './db/schema';
import { eq, sql } from 'drizzle-orm';
import { logAdminAction } from './services/adminAuditService';
import { isUuid } from './inputValidation';
import { validatePaymentProof } from './paymentValidation';

const PAYMENT_PUBLIC_MESSAGES = new Set([
  'Payment service is temporarily unavailable. Please try again later.',
  'No products are configured.',
  'Selected product is invalid.',
  'Selected payment method is invalid.',
  'Selected product is unavailable.',
  'You already have active Academic Year access.',
  'You already have active access for this period.',
  'The Academic Year upgrade is temporarily unavailable at the current configured prices.',
  'This payment method is not fully configured yet. Please choose another method or contact support.',
  'Telda username is required.',
  'Telda username is only used for Telda.',
  'Please provide a valid phone number.',
  'Please provide a valid full name.',
  'Please provide a valid Telda username.',
  'Invalid payment submission identifier.',
  'You already have a pending payment for this access period.',
  'Selected payment method is unavailable.',
  'Payment proof is invalid.',
  'A valid payment proof is required before approval.',
]);

function sendPaymentError(res: Response, error: unknown): void {
  if (error instanceof PaymentServiceError) {
    const message = PAYMENT_PUBLIC_MESSAGES.has(error.message) ? error.message : 'The payment request could not be completed. Please try again.';
    const status = Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 500;
    const code = /^[A-Z0-9_]{1,64}$/.test(error.code) ? error.code : 'PAYMENT_ERROR';
    res.status(status).json({ error: message, code, retryable: status >= 500 });
    return;
  }
  console.error('[Payment] Internal error:', error);
  res.status(500).json({ error:'Something went wrong. Please try again later.', code:'PAYMENT_INTERNAL_ERROR', retryable:true });
}

export function registerPaymentRoutes(app: express.Express) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
      fileSize: 10 * 1024 * 1024,
      files: 1,
      fields: 8,
      fieldSize: 16 * 1024,
      parts: 10,
      headerPairs: 200,
    },
  });

  // Public/Student routes
  app.get('/api/payment/methods', persistentRateLimitMiddleware('payment_methods_public', 120, 60_000, (req) => `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`), async (req: Request, res: Response) => {
    try {
      const methods = await getPaymentMethods(false);
      res.json({ ok: true, methods });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.get('/api/payment/pricing-for-user', requireAuth, persistentRateLimitMiddleware('payment_pricing_user', 60, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const productsList = await getProducts(false);
      const access = await getAccessState((req as any).user.id);
      const termPrice = productsList.find((p:any) => p.id === 'CURRENT_TERM')?.amount ?? null;
      const yearPrice = productsList.find((p:any) => p.id === 'ACADEMIC_YEAR')?.amount ?? null;
      const activeTermPurchase = access.upgradeAvailable ? (await getStudentEntitlements((req as any).user.id)).find((e:any) => e.status === 'ACTIVE' && e.plan === 'CURRENT_TERM' && e.academicYear === access.academicYear && e.term === access.term) : null;
      const historicalTermAmount = activeTermPurchase && Number.isFinite(Number(activeTermPurchase.amountPaid)) && Number(activeTermPurchase.amountPaid) > 0 ? Number(activeTermPurchase.amountPaid) : termPrice;
      res.json({ ok:true, products: productsList, access, academicYearPayableAmount: access.upgradeAvailable && historicalTermAmount != null && yearPrice != null ? Math.max(0, yearPrice-historicalTermAmount) : yearPrice });
    } catch(e:unknown){ sendPaymentError(res,e); }
  });

  app.get('/api/payment/pricing', persistentRateLimitMiddleware('payment_pricing_public', 120, 60_000, (req) => `ip:${req.ip || req.socket.remoteAddress || 'unknown'}`), async (_req: Request, res: Response) => {
    try {
      const products = await getProducts(false);
      res.json({ ok: true, products });
    } catch (e: unknown) {
      console.error('[Payment] Pricing load error:', e);
      res.status(503).json({ error: 'Pricing is temporarily unavailable. Please try again.', code: 'PRICING_UNAVAILABLE', retryable: true });
    }
  });

  app.get('/api/payment/submissions', requireAuth, persistentRateLimitMiddleware('payment_submissions_read', 60, 60_000, (req) => `user:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const submissions = await getStudentSubmissions(user.id);
      const entitlements = await getStudentEntitlements(user.id);
      res.json({ ok: true, submissions, entitlements });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.post('/api/payment/submissions/:id/cancel', requireAuth, persistentRateLimitMiddleware('payment_cancel', 20, 60_000, (req) => `user:${(req as any).user.id}`), express.json(), async (req: Request, res: Response) => {
    try { if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid payment submission identifier.', code: 'INVALID_ID' });
      const user = (req as any).user;
      const submission = await cancelPaymentSubmission(user.id, req.params.id);
      res.json({ ok: true, submission });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  const paymentSubmissionRateLimit = async (req: Request, res: Response, next: express.NextFunction) => {
    const user = (req as any).user;
    const submitKey = `user:${user.id}`;
    try {
      const rl = await allowPersistentRateLimit('payment_submit', submitKey, 5, 60_000, { failClosed: true });
      if (!rl.allowed) return res.status(429).json({ error: `Too many payment submissions. Please wait ${rl.retryAfterSeconds} seconds.`, code: 'RATE_LIMITED' });
      next();
    } catch {
      return res.status(503).json({ error: 'Payment submission is temporarily unavailable. Please try again shortly.', code: 'RATE_LIMIT_SERVICE_UNAVAILABLE', retryable: true });
    }
  };

  app.post('/api/payment/submit', requireAuth, paymentSubmissionRateLimit, upload.single('proof'), async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { plan, paymentMethod, fullName, phoneNumber, teldaUsername } = req.body;
      const clientRequestId = typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].trim().slice(0, 120) : undefined;
      const file = req.file;
      if (!file) return res.status(400).json({ error: 'Payment proof screenshot is required' });
      let validatedProofMime: ReturnType<typeof validatePaymentProof>;
      try {
        validatedProofMime = validatePaymentProof(file.buffer, file.mimetype);
      } catch (proofError) {
        return res.status(400).json({ error: proofError instanceof Error ? proofError.message : 'Payment proof is invalid.' });
      }
      if (typeof fullName !== 'string' || !fullName.trim() || fullName.trim().length > 120 || /[\u0000-\u001F\u007F]/.test(fullName)) return res.status(400).json({ error: 'Please provide a valid full name.' });
      if (typeof phoneNumber !== 'string' || phoneNumber.trim().length > 20 || !/^\+?[0-9 ()-]{8,20}$/.test(phoneNumber.trim())) return res.status(400).json({ error: 'Please provide a valid phone number.' });
      if (paymentMethod === 'MANUAL_TELDA' && (!teldaUsername || typeof teldaUsername !== 'string' || teldaUsername.trim().length > 100 || /[\u0000-\u001F\u007F]/.test(teldaUsername))) {
        return res.status(400).json({ error: 'Telda username is required' });
      }

      if (!['CURRENT_TERM', 'ACADEMIC_YEAR'].includes(plan)) {
         return res.status(400).json({ error: 'Invalid plan' });
      }

      const context = await getCurrentAcademicContext();

      const sub = await submitPayment({
        studentId: user.id,
        plan,
        paymentMethod,
        clientRequestId,
        academicYear: context.academicYear,
        term: context.term,
        fullName,
        phoneNumber,
        teldaUsername,
        proofMimeType: validatedProofMime,
        proofData: file.buffer,
      });

      res.json({ ok: true, submission: sub });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  // Admin routes - strictly guarded with requireAdmin
  app.get('/api/admin/check', requireAdmin, persistentRateLimitMiddleware('admin_check', 120, 60_000, (req) => `admin:${(req as any).user.id}`), async (req: Request, res: Response) => {
    const user = (req as any).user;
    res.json({ ok: true, isAdmin: true, user: { email: user.email, name: user.name, role: user.role } });
  });

  app.get('/api/admin/payments', requireAdmin, persistentRateLimitMiddleware('admin_payments_list', 120, 60_000, (req) => `admin:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const statusFilter = (req.query.status as string) || 'PENDING';
      let subs;
      if (statusFilter === 'ALL' || statusFilter === 'HISTORY') {
        subs = await getAllSubmissions(statusFilter === 'HISTORY' ? undefined : undefined);
      } else {
        subs = await getPendingSubmissions();
      }
      res.json({ ok: true, submissions: subs });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.get('/api/admin/payments/all', requireAdmin, persistentRateLimitMiddleware('admin_payments_all', 60, 60_000, (req) => `admin:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const subs = await getAllSubmissions();
      res.json({ ok: true, submissions: subs });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.get('/api/admin/payments/:id/proof', requireAdmin, persistentRateLimitMiddleware('admin_payment_proof', 30, 60_000, (req) => `admin:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try { if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid payment submission identifier.', code: 'INVALID_ID' });
      const proof = await getProof(req.params.id);
      if (!proof) return res.status(404).json({ error: 'Proof not found' });
      res.setHeader('Content-Type', proof.mimeType);
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Cache-Control', 'private, no-cache, no-store, must-revalidate');
      try { await logAdminAction({ adminId:(req as any).user.id, action:'PAYMENT_PROOF_ACCESSED', targetType:'PAYMENT_SUBMISSION', targetId:req.params.id }); } catch (auditError) { console.warn('[AdminAudit] PAYMENT_PROOF_ACCESSED audit write failed.', auditError instanceof Error ? auditError.message : String(auditError)); }
      res.send(proof.data);
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.post('/api/admin/payments/:id/approve', requireAdmin, persistentRateLimitMiddleware('admin_payment_approve', 60, 60_000, (req) => `admin:${(req as any).user.id}`), express.json(), async (req: Request, res: Response) => {
    try { if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid payment submission identifier.', code: 'INVALID_ID' });
      const adminUser = (req as any).user;
      const adminIdentifier = adminUser?.email || adminUser?.id || 'admin';
      await approvePayment(req.params.id, adminIdentifier);
      res.json({ ok: true, message: 'Payment approved successfully' });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.post('/api/admin/payments/:id/reject', requireAdmin, persistentRateLimitMiddleware('admin_payment_reject', 60, 60_000, (req) => `admin:${(req as any).user.id}`), express.json(), async (req: Request, res: Response) => {
    try { if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid payment submission identifier.', code: 'INVALID_ID' });
      const adminUser = (req as any).user;
      const adminIdentifier = adminUser?.email || adminUser?.id || 'admin';
      const { reason } = req.body;
      if (!reason || typeof reason !== 'string' || !reason.trim()) {
        return res.status(400).json({ error: 'Rejection reason is required' });
      }
      await rejectPayment(req.params.id, adminIdentifier, reason.trim());
      res.json({ ok: true, message: 'Payment rejected' });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });
  
  app.get('/api/admin/entitlements', requireAdmin, persistentRateLimitMiddleware('admin_entitlements_list', 120, 60_000, (req) => `admin:${(req as any).user.id}`), async (_req: Request, res: Response) => {
    try {
      res.json({ ok: true, entitlements: await getAdminEntitlements() });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.post('/api/admin/entitlements/:id/revoke', requireAdmin, persistentRateLimitMiddleware('admin_entitlement_revoke', 60, 60_000, (req) => `admin:${(req as any).user.id}`), express.json(), async (req: Request, res: Response) => {
    try { if (!isUuid(req.params.id)) return res.status(400).json({ error: 'Invalid entitlement identifier.', code: 'INVALID_ID' });
      const adminUser = (req as any).user;
      const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim() : '';
      if (!reason) return res.status(400).json({ error: 'A revocation reason is required.' });
      if (reason.length > 500) return res.status(400).json({ error: 'Revocation reason is too long.' });
      const entitlement = await revokeEntitlement(req.params.id, adminUser?.email || adminUser?.id || 'admin', reason);
      res.json({ ok: true, entitlement });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.get('/api/admin/products', requireAdmin, persistentRateLimitMiddleware('admin_products_list', 120, 60_000, (req) => `admin:${(req as any).user.id}`), async (_req: Request, res: Response) => {
    try { res.json({ ok: true, products: await getProducts() }); }
    catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.post('/api/admin/products', requireAdmin, persistentRateLimitMiddleware('admin_product_config', 30, 60_000, (req) => `admin:${(req as any).user.id}`), express.json(), async (req: Request, res: Response) => {
    try {
      const db = getDb();
      if (!db) return res.status(503).json({ error: 'Payment service is temporarily unavailable. Please try again later.', code: 'PAYMENT_UNAVAILABLE', retryable: true });
      const { id, amount, enabled, name } = req.body || {};
      if (!['CURRENT_TERM','ACADEMIC_YEAR'].includes(id)) return res.status(400).json({ error: 'Invalid product.' });
      if (!Number.isInteger(amount) || amount <= 0 || amount > 100000) return res.status(400).json({ error: 'Invalid price.' });
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Enabled must be a boolean.' });
      const normalizedName = typeof name === 'string' ? name.trim() : '';
      if (normalizedName && (normalizedName.length > 120 || /[\u0000-\u001F\u007F]/.test(normalizedName))) return res.status(400).json({ error: 'Invalid product name.' });
      const productName = normalizedName || (id === 'CURRENT_TERM' ? 'Current Term' : 'Academic Year');
      const nextVersion = await db.transaction(async (tx) => {
        const upserted = await tx.insert(products).values({ id, name: productName, amount, currency: 'EGP', enabled: enabled ? 1 : 0, version: 1 })
          .onConflictDoUpdate({ target: products.id, set: { name: productName, amount, currency: 'EGP', enabled: enabled ? 1 : 0, version: sql`${products.version} + 1`, updatedAt: new Date() } })
          .returning({ version: products.version });
        const version = Number(upserted[0]?.version || 1);
        await tx.insert(adminAuditLog).values({ adminId:(req as any).user.id, action:'PRODUCT_CONFIG_CHANGED', targetType:'PRODUCT', targetId:id, metadata:{ amount, enabled, name: productName, version } });
        return version;
      });
      invalidatePaymentConfigCache();
      res.json({ ok: true, products: await getProducts() });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.post('/api/admin/payment-methods', requireAdmin, persistentRateLimitMiddleware('admin_payment_method_config', 30, 60_000, (req) => `admin:${(req as any).user.id}`), express.json(), async (req: Request, res: Response) => {
    try {
      const db = getDb();
      if (!db) return res.status(503).json({ error: 'Payment service is temporarily unavailable. Please try again later.', code: 'PAYMENT_UNAVAILABLE', retryable: true });
      
      const { id, enabled, destination, instructions } = req.body;
      const allowedIds = new Set(['MANUAL_INSTAPAY', 'MANUAL_TELDA', 'MANUAL_VODAFONE_CASH']);
      if (!allowedIds.has(id)) return res.status(400).json({ error: 'Unsupported payment method.' });
      if (typeof enabled !== 'boolean') return res.status(400).json({ error: 'Enabled must be a boolean.' });
      const normalizedDestination = typeof destination === 'string' ? destination.trim() : '';
      const normalizedInstructions = typeof instructions === 'string' ? instructions.trim() : '';
      if (normalizedDestination.length > 250) return res.status(400).json({ error: 'Payment destination is too long.' });
      if (normalizedInstructions.length > 4000) return res.status(400).json({ error: 'Payment instructions are too long.' });
      if (enabled && !normalizedDestination) return res.status(400).json({ error: 'An enabled payment method must have a destination configured.' });
      
      await db.transaction(async (tx) => { const existing = await tx.select().from(paymentMethodsConfig).where(eq(paymentMethodsConfig.id, id)); if (existing.length === 0) { await tx.insert(paymentMethodsConfig).values({ id, enabled: enabled ? 1 : 0, destination: normalizedDestination, instructions: normalizedInstructions }); } else { await tx.update(paymentMethodsConfig).set({ enabled: enabled ? 1 : 0, destination: normalizedDestination, instructions: normalizedInstructions, updatedAt: new Date() }).where(eq(paymentMethodsConfig.id, id)); } await tx.insert(adminAuditLog).values({ adminId:(req as any).user.id, action:'PAYMENT_METHOD_CONFIG_CHANGED', targetType:'PAYMENT_METHOD', targetId:id, metadata:{ enabled, destinationConfigured: Boolean(normalizedDestination), instructionsLength: normalizedInstructions.length } }); });
      invalidatePaymentConfigCache();
      res.json({ ok: true, message: 'Payment method updated successfully' });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });

  app.get('/api/admin/academic-context', requireAdmin, persistentRateLimitMiddleware('admin_academic_context', 120, 60_000, (req) => `admin:${(req as any).user.id}`), async (req: Request, res: Response) => {
    try {
      const context = await getCurrentAcademicContext();
      const db = getDb();
      const config = db ? (await db.select().from(appConfig).limit(1))[0] : null;
      res.json({ ok: true, context, config });
    } catch (e: unknown) { sendPaymentError(res, e); }
  });
}
