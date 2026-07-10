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

Developer project/account management links are present in the shell, while their screens remain Task 8 scope as specified. The temporary browser artifacts, smoke database and development server were removed or stopped before commit.
