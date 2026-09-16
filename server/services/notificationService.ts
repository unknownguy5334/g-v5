import { and, desc, eq, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { notifications } from '../db/schema';

export async function createNotification(studentId: string, type: string, title: string, message: string) {
  const db = getDb();
  if (!db) return null;
  const rows = await db.insert(notifications).values({ studentId, type, title, message }).returning();
  return rows[0] || null;
}

export async function getNotifications(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  return db.select().from(notifications).where(eq(notifications.studentId, studentId)).orderBy(desc(notifications.createdAt)).limit(100);
}

export async function getUnreadNotificationCount(studentId: string) {
  const db = getDb(); if (!db) return 0;
  const rows = await db.select({ id: notifications.id }).from(notifications).where(and(eq(notifications.studentId, studentId), isNull(notifications.readAt))).limit(500);
  return rows.length;
}

export async function markNotificationRead(studentId: string, id: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const rows = await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.id, id), eq(notifications.studentId, studentId))).returning();
  if (!rows.length) throw new Error('Notification not found');
  return rows[0];
}

export async function markAllNotificationsRead(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  await db.update(notifications).set({ readAt: new Date() }).where(and(eq(notifications.studentId, studentId), isNull(notifications.readAt)));
}
