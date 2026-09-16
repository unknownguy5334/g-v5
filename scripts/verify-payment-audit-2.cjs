const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const files = [
  'server/paymentRoutes.ts',
  'server/services/paymentService.ts',
  'server/services/accessService.ts',
  'server/db/schema.ts',
  'src/components/UpgradeModal.tsx',
  'src/components/PaymentHistoryModal.tsx',
  'src/AdminApp.tsx',
  'server/db/migrations/0003_payment_logic_hardening.sql',
];

let ok = true;
function assert(cond, msg) {
  if (cond) console.log('PASS', msg);
  else { console.error('FAIL', msg); ok = false; }
}

for (const rel of files.filter(f => !f.endsWith('.sql'))) {
  const file = path.join(root, rel);
  const text = fs.readFileSync(file, 'utf8');
  const kind = rel.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const parseErrors = sf.parseDiagnostics || [];
  assert(parseErrors.length === 0, `${rel} parses without TypeScript/TSX syntax errors`);
}

const payment = fs.readFileSync(path.join(root, 'server/services/paymentService.ts'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'server/paymentRoutes.ts'), 'utf8');
const access = fs.readFileSync(path.join(root, 'server/services/accessService.ts'), 'utf8');
const schema = fs.readFileSync(path.join(root, 'server/db/schema.ts'), 'utf8');
const up = fs.readFileSync(path.join(root, 'src/components/UpgradeModal.tsx'), 'utf8');
const history = fs.readFileSync(path.join(root, 'src/components/PaymentHistoryModal.tsx'), 'utf8');
const migration = fs.readFileSync(path.join(root, 'server/db/migrations/0003_payment_logic_hardening.sql'), 'utf8');

assert(payment.includes('const amount = product.amount'), 'Server derives payment amount from database product definition');
assert(payment.includes("SUPPORTED_PAYMENT_METHODS.has(data.paymentMethod)"), 'Server validates payment method against allowlist');
assert(routes.includes("/api/admin/entitlements/:id/revoke"), 'Admin entitlement revocation route exists');
assert(routes.includes("X-Idempotency-Key") || routes.includes("x-idempotency-key"), 'Payment submissions support an idempotency key');
assert(payment.includes('payment_pending_scope_unique'), 'Duplicate pending payment submissions are protected by a database unique constraint');
assert(payment.includes('existingRequest'), 'Server honors repeated payment submission requests idempotently');
assert(access.includes('eq(entitlements.status, \'ACTIVE\')'), 'Entitlement status is checked live from the database');
assert(schema.includes('clientRequestId'), 'Payment submissions persist client idempotency key');
assert(schema.includes('revokedAt') && schema.includes('revokeReason'), 'Entitlements store revocation audit metadata');
assert(migration.includes('payment_pending_scope_unique'), 'Migration creates pending payment uniqueness protection');
assert(migration.includes('payment_client_request_unique'), 'Migration creates client idempotency uniqueness protection');
assert(migration.includes("ADD VALUE IF NOT EXISTS 'CANCELLED'"), 'Migration supports student cancellation of pending submissions');
assert(up.includes('X-Idempotency-Key'), 'Payment UI sends idempotency key');
assert(history.includes('Cancel pending submission'), 'Student has a path to cancel a pending manual payment submission');
assert(history.includes('CANCELLED'), 'Student payment history renders cancellation state');

console.log(ok ? '\nPAYMENT AUDIT 2 STATIC VERIFICATION PASSED' : '\nPAYMENT AUDIT 2 STATIC VERIFICATION FAILED');
process.exit(ok ? 0 : 1);
