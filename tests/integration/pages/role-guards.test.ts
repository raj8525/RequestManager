import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listManageableProjects: vi.fn(),
  listManageableUsersWithMemberships: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  requireCurrentUser: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/auth/current-user", () => ({
  requireCurrentUser: mocks.requireCurrentUser,
}));
vi.mock("@/db/runtime", () => ({ getRuntimeDatabase: () => ({ runtime: true }) }));
vi.mock("@/features/projects/queries", () => ({
  listManageableProjects: mocks.listManageableProjects,
}));
vi.mock("@/features/accounts/queries", () => ({
  listManageableUsersWithMemberships: mocks.listManageableUsersWithMemberships,
}));

describe("management page role guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireCurrentUser.mockResolvedValue({
      id: 19,
      username: "customer",
      displayName: "王客户",
      role: "CUSTOMER",
      mustChangePassword: false,
    });
  });

  it.each([
    ["projects", () => import("@/app/(app)/manage/projects/page")],
    ["users", () => import("@/app/(app)/manage/users/page")],
  ])("returns not found before loading %s management data for a customer", async (_, load) => {
    const { default: Page } = await load();

    await expect(Page()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.notFound).toHaveBeenCalledOnce();
    expect(mocks.listManageableProjects).not.toHaveBeenCalled();
    expect(mocks.listManageableUsersWithMemberships).not.toHaveBeenCalled();
  });
});
