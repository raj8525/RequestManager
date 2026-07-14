# Request List Sorting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved server-side request sorting, clickable table headers, final action column, and discoverable edit eligibility without weakening request state rules.

**Architecture:** Add validated sort fields and directions to the existing list query, map enum values to explicit business ranks in SQLite, and generate sort links from the server-rendered table. Keep customer attention grouping ahead of sorting and move the existing `RequestActions` component into the last table cell.

**Tech Stack:** Next.js App Router, TypeScript, Drizzle ORM, SQLite, React, Vitest, Testing Library, Playwright

## Global Constraints

- Default progress order is scheduled, unscheduled, completed; then urgent, important, normal; then newest updated time and descending ID.
- Customer reply attention and lifecycle grouping remain ahead of ordinary sorting.
- Sorting happens before pagination and survives filters, pagination, and refresh through URL parameters.
- Only owned, active, unscheduled customer requests are editable; ineligible owned requests keep a disabled edit control explaining the rule.
- Row actions render in the final table column on desktop and as the last record field on mobile.

---

### Task 1: Query sorting contract

**Files:**
- Modify: `src/features/requests/schemas.ts`
- Modify: `src/features/requests/queries.ts`
- Modify: `tests/unit/requests/sorting.test.ts`

- [ ] Write failing tests for the compound default order and explicit updated-time direction.
- [ ] Add whitelisted sort fields and directions to `listRequestsSchema`.
- [ ] Add fixed SQL ranks for progress, priority, type, and record status, then apply ordering before limit and offset.
- [ ] Run the sorting tests and confirm stable IDs and attention pinning.

### Task 2: Sortable table and action placement

**Files:**
- Modify: `src/app/(app)/requests/page.tsx`
- Modify: `src/features/requests/components/request-toolbar.tsx`
- Modify: `src/features/requests/components/request-list.tsx`
- Modify: `src/features/requests/components/request-actions.tsx`
- Modify: `src/app/globals.css`
- Modify: `tests/components/request-list.test.tsx`
- Modify: `tests/components/request-detail.test.tsx`

- [ ] Write failing component tests for sort links, `aria-sort`, final-cell actions, and disabled edit visibility.
- [ ] Parse and preserve `sort` and `direction` in the page, toolbar, and pagination values.
- [ ] Render accessible sort links and direction icons in every data header except actions.
- [ ] Move `RequestActions` to the final cell and keep owned ineligible edit controls visible but disabled.
- [ ] Update desktop widths and mobile grid placement without introducing overflow.

### Task 3: Documentation and end-to-end verification

**Files:**
- Modify: `docs/product.md`
- Modify: `docs/user-guide.md`
- Modify: `docs/testing.md`
- Modify: `docs/traceability.md`
- Modify: `e2e/request-lifecycle.spec.ts`

- [ ] Update product rules and user guidance with default and interactive sorting.
- [ ] Add browser assertions for default row order, header clicks, URL persistence, final action placement, and detail edit visibility.
- [ ] Run all tests, typecheck, lint, isolated production build, audit, and Playwright E2E.
- [ ] Commit and push only aligned feature files.
- [ ] Publish with `update`, then verify the live customer list and an eligible and ineligible request detail in a browser.
