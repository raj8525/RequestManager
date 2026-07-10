import {
  ClipboardList,
  KeyRound,
  LogOut,
  Menu,
  Plus,
} from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { logoutRuntimeAction } from "@/auth/runtime-actions";
import type { AuthenticatedUser } from "@/auth/session-service";

function Navigation({ actor }: { actor: AuthenticatedUser }) {
  return (
    <nav className="app-nav" aria-label="主导航">
      <Link href="/requests">
        <ClipboardList aria-hidden="true" size={18} />
        需求列表
      </Link>
      {actor.role === "CUSTOMER" ? (
        <Link href="/requests/new">
          <Plus aria-hidden="true" size={18} />
          新建需求
        </Link>
      ) : null}
    </nav>
  );
}

export function AppShell({
  actor,
  children,
}: {
  actor: AuthenticatedUser;
  children: ReactNode;
}) {
  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <Link className="app-brand" href="/requests" aria-label="RequestManager 首页">
          <span aria-hidden="true">RM</span>
          <strong>RequestManager</strong>
        </Link>
        <div className="app-sidebar__role">
          {actor.role === "CUSTOMER" ? "客户工作区" : "开发者工作区"}
        </div>
        <Navigation actor={actor} />
        <div className="app-sidebar__account">
          <div>
            <strong>{actor.displayName}</strong>
            <span>@{actor.username}</span>
          </div>
          <Link href="/account/password" title="修改密码">
            <KeyRound aria-hidden="true" size={17} />
            修改密码
          </Link>
          <form action={logoutRuntimeAction}>
            <button type="submit" title="退出登录">
              <LogOut aria-hidden="true" size={17} />
              退出登录
            </button>
          </form>
        </div>
      </aside>

      <header className="mobile-header">
        <Link className="app-brand" href="/requests">
          <span aria-hidden="true">RM</span>
          <strong>RequestManager</strong>
        </Link>
        <details className="mobile-menu">
          <summary aria-label="打开导航" title="打开导航">
            <Menu aria-hidden="true" size={20} />
          </summary>
          <div className="mobile-menu__panel">
            <Navigation actor={actor} />
            <Link href="/account/password">修改密码</Link>
            <form action={logoutRuntimeAction}>
              <button type="submit">退出登录</button>
            </form>
          </div>
        </details>
      </header>

      <main className="app-main">{children}</main>
    </div>
  );
}
