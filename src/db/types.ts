import type Database from "better-sqlite3";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "@/db/schema";

export type AppDatabase = {
  sqlite: Database.Database;
  db: BetterSQLite3Database<typeof schema>;
};

export type User = typeof schema.users.$inferSelect;
export type NewUser = typeof schema.users.$inferInsert;
export type Session = typeof schema.sessions.$inferSelect;
export type NewSession = typeof schema.sessions.$inferInsert;
export type AuthThrottle = typeof schema.authThrottle.$inferSelect;
export type NewAuthThrottle = typeof schema.authThrottle.$inferInsert;
export type Project = typeof schema.projects.$inferSelect;
export type NewProject = typeof schema.projects.$inferInsert;
export type ProjectMembership = typeof schema.projectMemberships.$inferSelect;
export type NewProjectMembership = typeof schema.projectMemberships.$inferInsert;
export type Request = typeof schema.requests.$inferSelect;
export type NewRequest = typeof schema.requests.$inferInsert;
export type Attachment = typeof schema.attachments.$inferSelect;
export type NewAttachment = typeof schema.attachments.$inferInsert;
export type PublicRemark = typeof schema.publicRemarks.$inferSelect;
export type NewPublicRemark = typeof schema.publicRemarks.$inferInsert;
export type PrivateNote = typeof schema.privateNotes.$inferSelect;
export type NewPrivateNote = typeof schema.privateNotes.$inferInsert;
export type ClarificationMessage = typeof schema.clarificationMessages.$inferSelect;
export type NewClarificationMessage = typeof schema.clarificationMessages.$inferInsert;
export type RequestEvent = typeof schema.requestEvents.$inferSelect;
export type NewRequestEvent = typeof schema.requestEvents.$inferInsert;

export type UserRole = (typeof schema.userRoles)[number];
export type RequestType = (typeof schema.requestTypes)[number];
export type RequestPriority = (typeof schema.requestPriorities)[number];
export type RequestProgressStatus = (typeof schema.requestProgressStatuses)[number];
export type RequestRecordStatus = (typeof schema.requestRecordStatuses)[number];
export type RequestEventType = (typeof schema.requestEventTypes)[number];
export type RequestEventVisibility = (typeof schema.requestEventVisibilities)[number];
