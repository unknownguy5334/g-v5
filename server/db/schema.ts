import { pgTable, text, timestamp, integer, jsonb, uuid, pgEnum, customType, index, uniqueIndex, foreignKey } from "drizzle-orm/pg-core";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const freeRunStatusEnum = pgEnum("free_run_status", ["available", "in-progress", "used"]);
export const termOverrideModeEnum = pgEnum("term_override_mode", ["AUTO", "FALL", "SPRING", "SUMMER"]);
export const paymentStatusEnum = pgEnum("payment_status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export const runStatusEnum = pgEnum("run_status", ["IN_PROGRESS", "SUCCEEDED", "FAILED", "CANCELLED"]);
export const accessStatusEnum = pgEnum("access_status", ["ACTIVE", "REVOKED"]);


export const accountDeletionTombstones = pgTable("account_deletion_tombstones", {
  userIdHash: text("user_id_hash").primaryKey(),
  deletedAt: timestamp("deleted_at").notNull().defaultNow(),
});

export const students = pgTable("students", {
  id: text("id").primaryKey(), // Neon Auth User ID
  email: text("email").notNull(),
  displayName: text("display_name"),
  role: text("role").notNull().default("STUDENT"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
  
  freeRunStatus: freeRunStatusEnum("free_run_status").notNull().default("available"),
  freeRunStartedAt: timestamp("free_run_started_at"),
  freeRunCompletedAt: timestamp("free_run_completed_at"),
  onboardingCompletedAt: timestamp("onboarding_completed_at"),
  deletionRequestedAt: timestamp("deletion_requested_at"),
  deletionScheduledFor: timestamp("deletion_scheduled_for"),
}, (table) => ({
  roleIdx: index("students_role_idx").on(table.role),
  lastActiveIdx: index("students_last_active_idx").on(table.lastActiveAt),
}));

export const appConfig = pgTable("app_config", {
  id: text("id").primaryKey(), // e.g., 'singleton'
  termOverrideMode: termOverrideModeEnum("term_override_mode").notNull().default("AUTO"),
  freeRunAllowance: integer("free_run_allowance").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  updatedIdx: index("app_config_updated_idx").on(table.updatedAt),
}));

export const runSessions = pgTable("run_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  accessType: text("access_type").notNull(), // FREE_RUN | PAID
  status: runStatusEnum("status").notNull().default("IN_PROGRESS"),
  academicYear: text("academic_year").notNull(),
  term: text("term").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  expiresAt: timestamp("expires_at"),
  completedAt: timestamp("completed_at"),
  failedAt: timestamp("failed_at"),
  resultCreated: integer("result_created").notNull().default(0),
  resultTokenHash: text("result_token_hash"),
}, (table) => ({
  studentStatusIdx: index("run_sessions_student_status_idx").on(table.studentId, table.status),
  studentStartedIdx: index("run_sessions_student_started_idx").on(table.studentId, table.startedAt),
  studentTypeStatusIdx: index("run_sessions_student_type_status_idx").on(table.studentId, table.accessType, table.status),
}));

export const products = pgTable("products", {
  id: text("id").primaryKey(), // CURRENT_TERM | ACADEMIC_YEAR
  name: text("name").notNull(),
  amount: integer("amount").notNull(),
  currency: text("currency").notNull().default("EGP"),
  enabled: integer("enabled").notNull().default(1),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  version: integer("version").notNull().default(1),
}, (table) => ({
  enabledIdx: index("products_enabled_idx").on(table.enabled),
}));

export const savedCourses = pgTable("saved_courses", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  courseData: jsonb("course_data").notNull(), // Array of course records
  academicYear: text("academic_year").notNull(),
  term: text("term").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  studentIdx: index("saved_courses_student_idx").on(table.studentId),
  studentContextIdx: index("saved_courses_student_context_idx").on(table.studentId, table.academicYear, table.term),
  studentContextUnique: uniqueIndex("saved_courses_student_context_unique").on(table.studentId, table.academicYear, table.term),
  idStudentUnique: uniqueIndex("saved_courses_id_student_unique").on(table.id, table.studentId),
}));

export const courseSetRevisions = pgTable("course_set_revisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  courseSetId: uuid("course_set_id").notNull().references(() => savedCourses.id, { onDelete: "cascade" }),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  courseData: jsonb("course_data").notNull(),
  title: text("title"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  courseSetCreatedIdx: index("course_set_revisions_course_set_created_idx").on(table.courseSetId, table.createdAt),
  studentCreatedIdx: index("course_set_revisions_student_created_idx").on(table.studentId, table.createdAt),
  courseSetStudentFk: foreignKey({
    columns: [table.courseSetId, table.studentId],
    foreignColumns: [savedCourses.id, savedCourses.studentId],
    name: "course_set_revisions_course_set_student_fk",
  }),
}));

export const savedSchedules = pgTable("saved_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").references(() => runSessions.id, { onDelete: "set null" }),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  academicYear: text("academic_year").notNull(),
  term: text("term").notNull(),
  title: text("title"),
  isFavorite: integer("is_favorite").notNull().default(0),
  scheduleData: jsonb("schedule_data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  studentCreatedIdx: index("saved_schedules_student_created_idx").on(table.studentId, table.createdAt),
  academicTermIdx: index("saved_schedules_academic_term_idx").on(table.academicYear, table.term),
  studentFavoriteIdx: index("saved_schedules_student_favorite_idx").on(table.studentId, table.isFavorite),
}));

export const activityAudit = pgTable("activity_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ({
  studentTimeIdx: index("activity_audit_student_time_idx").on(table.studentId, table.timestamp),
  eventTimeIdx: index("activity_audit_event_time_idx").on(table.eventType, table.timestamp),
}));

export const paymentMethodsConfig = pgTable("payment_methods_config", {
  id: text("id").primaryKey(), // e.g., 'instapay', 'telda', 'vodafone_cash'
  enabled: integer("enabled").notNull().default(1),
  destination: text("destination").notNull(),
  instructions: text("instructions"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  enabledIdx: index("payment_methods_enabled_idx").on(table.enabled),
}));

export const paymentProofs = pgTable("payment_proofs", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id").notNull(), 
  mimeType: text("mime_type").notNull(),
  data: bytea("data").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  submissionIdx: index("payment_proofs_submission_idx").on(table.submissionId),
  submissionPairUnique: uniqueIndex("payment_proofs_id_submission_unique").on(table.id, table.submissionId),
  submissionFk: foreignKey({
    columns: [table.submissionId],
    foreignColumns: [paymentSubmissions.id],
    name: "payment_proofs_submission_fk",
  }),
}));

export const paymentSubmissions = pgTable("payment_submissions", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(), 
  amount: integer("amount").notNull(),
  productNameSnapshot: text("product_name_snapshot").notNull(),
  productVersion: integer("product_version").notNull().default(1),
  paymentMethod: text("payment_method").notNull(), 
  clientRequestId: text("client_request_id"),
  academicYear: text("academic_year").notNull(),
  term: text("term"), 
  fullName: text("full_name").notNull(),
  phoneNumber: text("phone_number").notNull(),
  teldaUsername: text("telda_username"),
  proofId: uuid("proof_id").references(() => paymentProofs.id), 
  status: paymentStatusEnum("payment_status").notNull().default("PENDING"),
  rejectionReason: text("rejection_reason"),
  reviewedAt: timestamp("reviewed_at"),
  reviewedBy: text("reviewed_by"), 
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => ({
  statusCreatedIdx: index("payment_submissions_status_created_idx").on(table.status, table.createdAt),
  studentCreatedIdx: index("payment_submissions_student_created_idx").on(table.studentId, table.createdAt),
  clientRequestIdx: index("payment_submissions_client_request_idx").on(table.clientRequestId),
  proofSubmissionFk: foreignKey({
    columns: [table.proofId, table.id],
    foreignColumns: [paymentProofs.id, paymentProofs.submissionId],
    name: "payment_submissions_proof_submission_fk",
  }),
}));

export const entitlements = pgTable("entitlements", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  plan: text("plan").notNull(),
  academicYear: text("academic_year").notNull(),
  term: text("term"), 
  status: accessStatusEnum("status").notNull().default("ACTIVE"),
  productNameSnapshot: text("product_name_snapshot").notNull().default(""),
  amountPaid: integer("amount_paid").notNull().default(0),
  currency: text("currency").notNull().default("EGP"),
  productVersion: integer("product_version").notNull().default(1),
  submissionId: uuid("submission_id").references(() => paymentSubmissions.id),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revokedAt: timestamp("revoked_at"),
  revokedBy: text("revoked_by"),
  revokeReason: text("revoke_reason"),
}, (table) => ({
  studentStatusIdx: index("entitlements_student_status_idx").on(table.studentId, table.status),
  studentCreatedIdx: index("entitlements_student_created_idx").on(table.studentId, table.createdAt),
  academicTermStatusIdx: index("entitlements_academic_term_status_idx").on(table.academicYear, table.term, table.status),
}));


export const adminAuditLog = pgTable("admin_audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  adminId: text("admin_id").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(),
  targetId: text("target_id"),
  metadata: jsonb("metadata"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
}, (table) => ({
  adminTimeIdx: index("admin_audit_log_admin_time_idx").on(table.adminId, table.timestamp),
  actionTimeIdx: index("admin_audit_log_action_time_idx").on(table.action, table.timestamp),
}));

export const notifications = pgTable("notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  studentId: text("student_id").notNull().references(() => students.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("INFO"),
  title: text("title").notNull(),
  message: text("message").notNull(),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  studentCreatedIdx: index("notifications_student_created_idx").on(table.studentId, table.createdAt),
  studentReadIdx: index("notifications_student_read_idx").on(table.studentId, table.readAt),
}));
