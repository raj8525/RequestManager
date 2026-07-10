# Task 7 Report: Application Shell, Login and Request Experience

## Scope delivered

- Added a Chinese login experience, forced-password route, database-backed runtime Server Action adapters, protected application layout and role-derived navigation.
- Added the complete request list experience with URL search/filter/pagination, customer reply priority styling and text, compact developer/customer lifecycle controls, desktop table and mobile compact rows.
- Added customer create/edit multipart forms with a stable idempotency key, optimistic version, retained attachments, select/drag/paste upload, preview/removal, client limits and server-error recovery without clearing input.
- Added authorized detail composition for request data, protected screenshots, customer-visible remarks, clarification messages and the current developer's own private note only.
- Added developer progress/pause/resume/archive/restore controls and customer owner edit/pause controls. Destructive lifecycle actions require confirmation.
- Added neutral/charcoal/teal visual tokens, accessible fields, icon buttons with labels/tooltips, focus states, empty/error states and responsive layouts without marketing decoration or nested cards.
- Added authorized project and attachment DTO queries; pages never read database rows directly and customer detail payloads never query private notes.

## TDD evidence

Initial focused component run failed because the requested components did not exist. Tests were then implemented to cover:

- image clipboard versus plain-text paste behavior;
- screenshot type/count validation and accessible removal;
- reply attention text plus visual state;
- one stable responsive request row and empty state;
- developer list controls;
- literal rendering of `<b>` user input without a `b` element;
- generic login failure and password confirmation;
- multipart form error association, value preservation and stable idempotency;
- role-specific detail sections and private-note exclusion.

Final component result: 5 files and 16 tests passed.

## Verification

- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 20 files and 122 tests passed.
- `npm run build`: passed; login, password and request pages are dynamic routes and do not perform build-time database access.
- Runtime smoke: migrated a temporary SQLite database, started Next.js with matching `APP_ORIGIN`, and verified customer login redirects to `/requests` with the seeded pending request.
- Playwright visual checks: inspected the authenticated request list at 1280x720 and 390x844. Fixed desktop toolbar wrapping and table clipping; mobile navigation, filter grid, pending text, compact row and actions rendered without overlap.

## Boundary

Developer project/account management links are intentionally withheld until their Task 8 screens exist, so the Task 7 shell exposes no dead navigation. The temporary browser artifacts, smoke database and development server were removed or stopped before commit.

## UI review remediation

- Removed the developer management dead links pending Task 8, while retaining the request list, password and logout paths on desktop and mobile.
- Made edit-time screenshot limits account for retained and newly selected files together: at most 8 images and 30 MiB total. Retained attachment removal is disabled for the full pending submission window.
- Upgraded confirmation dialogs with bidirectional Tab trapping, Escape handling, prior-focus capture and focus restoration. Backdrop, Escape and both actions cannot cancel a pending operation.
- Added invalid-page recovery that preserves active filters and returns directly to page one, including when the current result set has zero or one page.
- Stabilized mobile request rows with a 304 px height, explicit `88px 82px 44px 44px` grid rows and bounded cell overflow. Compact actions stay on one horizontally scrollable line without removing any row field.

Review TDD began with 8 expected failures across dead navigation, retained screenshot count/bytes, pending removal, dialog focus behavior and pagination recovery. Focused behavior then passed 15/15 tests; the final component suite passed 25/25 tests.

Authenticated Playwright checks used deliberately long project, submitter and summary text. Before the responsive fix, 360 px rows varied from 322.5 to 357.5 px and compact actions wrapped to 69.5-104.5 px. At both 360x800 and 390x844 after the fix, all rows measured exactly 304 px, actions measured 34 px with `nowrap` and `overflow-x: auto`, no table cell was clipped, and the document had no horizontal overflow.

Final verification: 23 test files and 131 tests passed; typecheck, lint and production build passed.
