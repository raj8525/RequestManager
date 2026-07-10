import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  actor: {
    id: 8,
    username: "developer",
    displayName: "李开发",
    role: "DEVELOPER" as const,
    mustChangePassword: false,
  },
  createProject: vi.fn(),
  createUser: vi.fn(),
  database: { runtime: true },
  getCurrentUser: vi.fn(),
  revalidatePath: vi.fn(),
  replaceCustomerMemberships: vi.fn(),
  resetUserPassword: vi.fn(),
  setProjectActive: vi.fn(),
  setUserActive: vi.fn(),
  updateProject: vi.fn(),
  updateUserIdentity: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/auth/current-user", () => ({ getCurrentUser: mocks.getCurrentUser }));
vi.mock("@/db/runtime", () => ({ getRuntimeDatabase: () => mocks.database }));
vi.mock("@/features/accounts/service", () => ({
  createUser: mocks.createUser,
  replaceCustomerMemberships: mocks.replaceCustomerMemberships,
  resetUserPassword: mocks.resetUserPassword,
  setUserActive: mocks.setUserActive,
  updateUserIdentity: mocks.updateUserIdentity,
}));
vi.mock("@/features/projects/service", () => ({
  createProject: mocks.createProject,
  setProjectActive: mocks.setProjectActive,
  updateProject: mocks.updateProject,
}));

describe("management runtime actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getCurrentUser.mockResolvedValue(mocks.actor);
    mocks.createUser.mockResolvedValue({ ok: true, data: { id: 91 } });
    mocks.createProject.mockResolvedValue({ ok: true, data: { id: 41 } });
    mocks.resetUserPassword.mockResolvedValue({ ok: true, data: { id: 91 } });
    mocks.replaceCustomerMemberships.mockResolvedValue({
      ok: true,
      data: { customerId: 91, projectIds: [41] },
    });
  });

  it("unwraps password reset FormData before calling the domain service", async () => {
    const { resetUserPasswordRuntimeAction } = await import(
      "@/features/accounts/runtime-actions"
    );
    const formData = new FormData();
    formData.set("userId", "91");
    formData.set("password", "replacement password");

    await expect(resetUserPasswordRuntimeAction(formData)).resolves.toMatchObject({
      ok: true,
    });
    expect(mocks.resetUserPassword).toHaveBeenCalledWith(
      mocks.database,
      mocks.actor,
      { userId: 91, password: "replacement password" },
    );
  });

  it("passes the live session actor to account commands and refreshes the exact list", async () => {
    const { createUserRuntimeAction } = await import(
      "@/features/accounts/runtime-actions"
    );
    const formData = new FormData();
    formData.set("username", "customer");
    formData.set("displayName", "王客户");
    formData.set("password", "temporary password");
    formData.set("role", "CUSTOMER");

    await expect(createUserRuntimeAction(formData)).resolves.toMatchObject({ ok: true });
    expect(mocks.createUser).toHaveBeenCalledWith(
      mocks.database,
      mocks.actor,
      {
        username: "customer",
        displayName: "王客户",
        password: "temporary password",
        role: "CUSTOMER",
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/manage/users");
  });

  it("refreshes project-dependent pages only after a successful project command", async () => {
    const { createProjectRuntimeAction } = await import(
      "@/features/projects/runtime-actions"
    );
    const input = { code: "PORTAL", name: "客户门户", description: "" };

    await expect(createProjectRuntimeAction(input)).resolves.toMatchObject({ ok: true });
    expect(mocks.createProject).toHaveBeenCalledWith(
      mocks.database,
      mocks.actor,
      input,
    );
    expect(mocks.revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      "/manage/projects",
      "/manage/users",
      "/requests",
      "/requests/new",
    ]);
  });

  it("does not call a command when the session is absent", async () => {
    mocks.getCurrentUser.mockResolvedValueOnce(null);
    const { replaceCustomerMembershipsRuntimeAction } = await import(
      "@/features/accounts/runtime-actions"
    );

    await expect(
      replaceCustomerMembershipsRuntimeAction({ customerId: 91, projectIds: [41] }),
    ).resolves.toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect(mocks.replaceCustomerMemberships).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
