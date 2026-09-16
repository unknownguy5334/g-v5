import { getDb } from '../db';
import { adminAuditLog } from '../db/schema';

export async function logAdminAction(input: {
  adminId: string;
  action: string;
  targetType: string;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  const db = getDb();
  if (!db) throw new Error('DB not initialized');
  await db.insert(adminAuditLog).values({
    adminId: input.adminId,
    action: input.action,
    targetType: input.targetType,
    targetId: input.targetId ?? null,
    metadata: input.metadata,
  });
}
