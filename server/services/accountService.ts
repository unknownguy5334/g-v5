import { and, desc, eq } from 'drizzle-orm';
import { getDb } from '../db';
import { students, savedSchedules, savedCourses, courseSetRevisions, activityAudit } from '../db/schema';
import { getStudentSubmissions, getStudentEntitlements, getProducts } from './paymentService';
import { getAccessState } from './accessService';
import { getCurrentAcademicContext } from './academicContext';
import { listStudentCourseSets } from './courseService';
import { getStudentSchedules } from './scheduleService';
import { getUnreadNotificationCount } from './notificationService';
import { logActivity } from './studentProfile';

export async function getAccountOverview(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const [studentRows, access, payments, entitlements, schedules, courseSets, context, products, currentCourses, unreadCount] = await Promise.all([
    db.select().from(students).where(eq(students.id, studentId)).limit(1),
    getAccessState(studentId), getStudentSubmissions(studentId), getStudentEntitlements(studentId),
    getStudentSchedules(studentId), listStudentCourseSets(studentId), getCurrentAcademicContext(), getProducts(false),
    import('./courseService').then(m => m.getStudentCourses(studentId)), getUnreadNotificationCount(studentId),
  ]);
  return { profile: studentRows[0], access, payments, entitlements, schedules, courseSets, currentCourses, context, products, unreadCount };
}

export async function markOnboardingCompleted(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  await db.update(students).set({ onboardingCompletedAt: new Date(), updatedAt: new Date() }).where(eq(students.id, studentId));
}

export async function duplicateCourseSet(studentId: string, sourceId: string, title?: string, replaceExisting = false) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const normalizedTitle = typeof title === 'string' ? title.trim() : '';
  if (normalizedTitle.length > 120 || /[\u0000-\u001F\u007F]/.test(normalizedTitle)) {
    throw new Error('Course set title is invalid.');
  }
  const context = await getCurrentAcademicContext();
  const sourceRows = await db.select().from(savedCourses).where(and(eq(savedCourses.id, sourceId), eq(savedCourses.studentId, studentId))).limit(1);
  const source = sourceRows[0]; if (!source) throw new Error('Course set not found');
  const targetRows = await db.select().from(savedCourses).where(and(eq(savedCourses.studentId, studentId), eq(savedCourses.academicYear, context.academicYear), eq(savedCourses.term, context.term))).limit(1);
  if (targetRows.length && !replaceExisting) {
    const error = new Error('A course set already exists for the current term. Confirm that you want to replace it.');
    (error as any).code = 'COURSE_SET_EXISTS';
    throw error;
  }
  if (targetRows.length) {
    const existingTarget = targetRows[0];
    await db.insert(courseSetRevisions).values({ courseSetId: existingTarget.id, studentId, courseData: existingTarget.courseData, title: existingTarget.title });
    const rows = await db.update(savedCourses).set({ courseData: source.courseData, title: normalizedTitle || `${context.term} ${context.academicYear} Courses`, updatedAt: new Date() }).where(eq(savedCourses.id, existingTarget.id)).returning();
    return rows[0];
  }
  const rows = await db.insert(savedCourses).values({ studentId, courseData: source.courseData, academicYear: context.academicYear, term: context.term, title: normalizedTitle || `${context.term} ${context.academicYear} Courses` }).returning();
  await logActivity(studentId, 'COURSE_SET_DUPLICATED', { sourceId, targetId: rows[0].id, academicYear: context.academicYear, term: context.term });
  return rows[0];
}

export async function requestAccountDeletion(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const now = new Date(); const scheduled = new Date(now.getTime() + 7 * 86400000);
  await db.update(students).set({ deletionRequestedAt: now, deletionScheduledFor: scheduled, updatedAt: now }).where(eq(students.id, studentId));
  await logActivity(studentId, 'ACCOUNT_DELETION_REQUESTED', { scheduledFor: scheduled.toISOString() });
  return scheduled;
}

export async function cancelAccountDeletion(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  await db.update(students).set({ deletionRequestedAt: null, deletionScheduledFor: null, updatedAt: new Date() }).where(eq(students.id, studentId));
  await logActivity(studentId, 'ACCOUNT_DELETION_CANCELLED');
}

export async function getAdminStudentDirectory(search = '') {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const q = search.trim().toLowerCase();
  const rows = await db.select().from(students).orderBy(desc(students.createdAt)).limit(500);
  const filtered = q ? rows.filter(s => s.email.toLowerCase().includes(q) || String(s.displayName || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) : rows;
  const results: Array<any> = new Array(filtered.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < filtered.length) {
      const index = nextIndex++;
      const student = filtered[index];
      const [scheduleRows, courseRows] = await Promise.all([
        db.select({ id: savedSchedules.id }).from(savedSchedules).where(eq(savedSchedules.studentId, student.id)).limit(1),
        db.select({ id: savedCourses.id }).from(savedCourses).where(eq(savedCourses.studentId, student.id)).limit(1),
      ]);
      const access = await getAccessState(student.id);
      results[index] = { student, access, hasSchedules: scheduleRows.length > 0, hasCourses: courseRows.length > 0 };
    }
  };
  await Promise.all(Array.from({ length: Math.min(8, filtered.length) }, () => worker()));
  return results;
}

export async function getAdminStudentDetail(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const studentRows = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const student = studentRows[0]; if (!student) throw new Error('Student not found');
  const [payments, entitlements, schedules, courses, activity] = await Promise.all([getStudentSubmissions(studentId), getStudentEntitlements(studentId), getStudentSchedules(studentId), listStudentCourseSets(studentId), db.select().from(activityAudit).where(eq(activityAudit.studentId, studentId)).orderBy(desc(activityAudit.timestamp)).limit(100)]);
  return { student, access: await getAccessState(studentId), payments, entitlements, schedules, courses, activity };
}
