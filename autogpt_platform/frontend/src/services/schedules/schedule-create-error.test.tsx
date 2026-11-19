import { ApiError, AuthTokenUnavailableError } from "@/lib/api-error";
import { render, screen } from "@/tests/integrations/test-utils";
import type { ReactElement } from "react";
import { describe, expect, test } from "vitest";
import { scheduleCreateErrorToast } from "./schedule-create-error";

function expectSchedulesLink(action: React.ReactNode) {
  expect(action).toBeDefined();
  const { unmount } = render(action as ReactElement);
  expect(
    screen.getByRole("link", { name: "View schedules" }).getAttribute("href"),
  ).toBe("/library/followups");
  unmount();
}

describe("scheduleCreateErrorToast", () => {
  test("a 503 says the schedule may already exist and links to the schedules", () => {
    const { description, action } = scheduleCreateErrorToast(
      new ApiError("Service Unavailable", 503, {
        detail: "Service Unavailable",
      }),
    );
    expect(description).toBe(
      "We couldn't confirm the schedule was saved, so it may already exist. Check your schedules before trying again.",
    );
    expectSchedulesLink(action);
  });

  test("a 409 says an earlier try may already exist and links to the schedules", () => {
    const { description, action } = scheduleCreateErrorToast(
      new ApiError("Conflict", 409, { detail: "Conflict" }),
    );
    expect(description).toBe(
      "A schedule from an earlier try may already exist. Check your schedules before trying again.",
    );
    expectSchedulesLink(action);
  });

  test("a 400 shows the server's message and offers no link", () => {
    const { description, action } = scheduleCreateErrorToast(
      new ApiError("Cron expression '0 0 31 2 *' never fires", 400, {
        detail: "Cron expression '0 0 31 2 *' never fires",
      }),
    );
    expect(description).toBe("Cron expression '0 0 31 2 *' never fires");
    expect(action).toBeUndefined();
  });

  test("a token that could not be minted shows its own message and offers no link", () => {
    const { description, action } = scheduleCreateErrorToast(
      new AuthTokenUnavailableError(),
    );
    expect(description).toBe(
      "Could not verify your sign-in. Try again in a moment.",
    );
    expect(action).toBeUndefined();
  });

  test("an error that is not from the server says the schedule may already exist and links to the schedules", () => {
    const { description, action } = scheduleCreateErrorToast(
      new TypeError("Failed to fetch"),
    );
    expect(description).toBe(
      "We couldn't confirm the schedule was saved, so it may already exist. Check your schedules before trying again.",
    );
    expectSchedulesLink(action);
  });
});
