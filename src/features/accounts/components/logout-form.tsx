import { LogOut } from "lucide-react";

import { logoutRuntimeAction } from "@/auth/runtime-actions";
import { Button } from "@/components/ui/button";

export function LogoutForm() {
  return (
    <form
      action={logoutRuntimeAction}
      aria-label="退出登录"
      className="auth-secondary-action"
    >
      <Button type="submit" variant="quiet" className="button--full">
        <LogOut aria-hidden="true" size={17} />
        退出登录
      </Button>
    </form>
  );
}
