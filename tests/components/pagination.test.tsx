/** @vitest-environment jsdom */

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Pagination } from "@/components/ui/pagination";

afterEach(cleanup);

describe("Pagination", () => {
  it.each([
    { page: 5, pageCount: 3 },
    { page: 2, pageCount: 1 },
  ])(
    "offers a first-page recovery link for invalid page $page of $pageCount",
    ({ page, pageCount }) => {
      render(
        <Pagination
          pathname="/requests"
          searchParams={{ priority: "URGENT", page: String(page) }}
          page={page}
          pageCount={pageCount}
          total={20}
        />,
      );

      expect(screen.getByRole("link", { name: "回到第一页" })).toHaveAttribute(
        "href",
        "/requests?priority=URGENT",
      );
    },
  );
});
