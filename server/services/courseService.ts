import { and, desc, eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { courseSetRevisions, savedCourses } from '../db/schema';
import { logActivity } from './studentProfile';
import { getCurrentAcademicContext } from './academicContext';

export async function saveStudentCourses(studentId: string, courseData: any, title?: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const context = await getCurrentAcademicContext();
  const existing = await db.select().from(savedCourses).where(and(eq(savedCourses.studentId, studentId), eq(savedCourses.academicYear, context.academicYear), eq(savedCourses.term, context.term))).limit(1);
  if (existing.length) {
    const nextData = JSON.stringify(courseData);
    const previousData = JSON.stringify(existing[0].courseData);
    const nextTitle = title?.trim() || existing[0].title;
    if (nextData !== previousData || nextTitle !== existing[0].title) {
      await db.insert(courseSetRevisions).values({
        courseSetId: existing[0].id,
        studentId,
        courseData: existing[0].courseData,
        title: existing[0].title,
      });
      await db.execute(
        sql`DELETE FROM course_set_revisions WHERE course_set_id = ${existing[0].id} AND id NOT IN (SELECT id FROM course_set_revisions WHERE course_set_id = ${existing[0].id} ORDER BY created_at DESC LIMIT 20)`
      );
      await db.update(savedCourses).set({ courseData, title: nextTitle, updatedAt: new Date() }).where(eq(savedCourses.id, existing[0].id));
    }
  } else {
    await db.insert(savedCourses).values({ studentId, courseData, academicYear: context.academicYear, term: context.term, title: title?.trim() || `${context.term.charAt(0)}${context.term.slice(1).toLowerCase()} ${context.academicYear} Courses` });
  }
  await logActivity(studentId, 'COURSES_SAVED', { count: Array.isArray(courseData) ? courseData.length : 0, academicYear: context.academicYear, term: context.term });
}

export async function getStudentCourses(studentId: string, academicYear?: string, term?: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const context = await getCurrentAcademicContext();
  const rows = await db.select().from(savedCourses).where(and(eq(savedCourses.studentId, studentId), eq(savedCourses.academicYear, academicYear || context.academicYear), eq(savedCourses.term, term || context.term))).orderBy(desc(savedCourses.updatedAt)).limit(1);
  return rows[0]?.courseData || null;
}

export async function listStudentCourseSets(studentId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  return db.select().from(savedCourses).where(eq(savedCourses.studentId, studentId)).orderBy(desc(savedCourses.updatedAt)).limit(100);
}

export async function restoreLatestCourseRevision(studentId: string, courseSetId: string) {
  const db = getDb(); if (!db) throw new Error('DB not initialized');
  const current = await db.select().from(savedCourses).where(and(eq(savedCourses.id, courseSetId), eq(savedCourses.studentId, studentId))).limit(1);
  if (!current.length) throw new Error('Course set not found');
  const revision = await db.select().from(courseSetRevisions).where(and(eq(courseSetRevisions.courseSetId, courseSetId), eq(courseSetRevisions.studentId, studentId))).orderBy(desc(courseSetRevisions.createdAt)).limit(1);
  if (!revision.length) throw new Error('No previous course version is available.');
  const now = new Date();
  await db.insert(courseSetRevisions).values({ courseSetId, studentId, courseData: current[0].courseData, title: current[0].title });
  const rows = await db.update(savedCourses).set({ courseData: revision[0].courseData, title: revision[0].title, updatedAt: now }).where(and(eq(savedCourses.id, courseSetId), eq(savedCourses.studentId, studentId))).returning();
  await logActivity(studentId, 'COURSE_SET_REVISION_RESTORED', { courseSetId });
  return rows[0];
}
