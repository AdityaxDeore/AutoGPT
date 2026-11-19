import { afterEach, describe, expect, test } from "vitest";
import {
  forgetScheduleCreateKey,
  withScheduleCreateKey,
} from "./schedule-create-key";

const create = {
  graphId: "graph-1",
  data: { name: "Morning run", cron: "0 9 * * *", inputs: { topic: "news" } },
};

afterEach(() => {
  window.sessionStorage.clear();
});

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("schedule create keys", () => {
  test("with no user, each create mints a fresh key and stores nothing", () => {
    const first = withScheduleCreateKey({ userId: undefined, create });
    const second = withScheduleCreateKey({ userId: undefined, create });

    expect(first.data.schedule_id).toMatch(UUID_V4);
    expect(second.data.schedule_id).toMatch(UUID_V4);
    expect(second.data.schedule_id).not.toBe(first.data.schedule_id);
    // Nothing persisted: no slot holds a key for a later attempt to reuse.
    expect(window.sessionStorage.length).toBe(0);
  });

  test("a late answer to an earlier attempt leaves the key a newer attempt took", () => {
    const userId = "user-1";
    const earlier = withScheduleCreateKey({ userId, create });
    forgetScheduleCreateKey({ userId, create: earlier });
    const newer = withScheduleCreateKey({ userId, create });

    forgetScheduleCreateKey({ userId, create: earlier });

    expect(withScheduleCreateKey({ userId, create }).data.schedule_id).toBe(
      newer.data.schedule_id,
    );
    expect(newer.data.schedule_id).not.toBe(earlier.data.schedule_id);
  });

  test("another account signed in to the same tab doesn't inherit a key", () => {
    const first = withScheduleCreateKey({ userId: "user-1", create });

    const other = withScheduleCreateKey({ userId: "user-2", create });

    expect(other.data.schedule_id).not.toBe(first.data.schedule_id);
    expect(
      withScheduleCreateKey({ userId: "user-1", create }).data.schedule_id,
    ).toBe(first.data.schedule_id);
  });
});
