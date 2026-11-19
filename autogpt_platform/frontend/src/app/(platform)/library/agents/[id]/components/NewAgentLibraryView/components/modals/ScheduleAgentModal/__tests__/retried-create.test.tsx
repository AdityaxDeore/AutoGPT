import { getPostV1CreateExecutionScheduleResponseMock } from "@/app/api/__generated__/endpoints/schedules/schedules.msw";
import type { LibraryAgent } from "@/app/api/__generated__/models/libraryAgent";
import { Toaster } from "@/components/molecules/Toast/toaster";
import { useAuthStore } from "@/lib/auth/hooks/useAuthStore";
import { server } from "@/mocks/mock-server";
import { render, screen, waitFor } from "@/tests/integrations/test-utils";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { ScheduleAgentModal } from "../ScheduleAgentModal";

const agent = {
  id: "lib-1",
  graph_id: "graph-xyz",
  graph_version: 1,
  name: "My agent",
  recommended_schedule_cron: null,
} as unknown as LibraryAgent;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  window.sessionStorage.clear();
  vi.unstubAllGlobals();
});

// The create guard waits for the auth store to settle and hashes the create
// key with the signed-in user's id, so every create test runs with a user.
beforeEach(() => {
  useAuthStore.setState({
    user: { id: "user-1", email: "user-1@example.com", user_metadata: {} },
    isUserLoading: false,
    hasLoadedUser: true,
  });
});

const NO_ANSWER = 0;

// Answers the creates with these statuses in turn (NO_ANSWER drops the
// connection), then with success, and collects the key each one carried.
function answerCreates(statuses: number[]) {
  const keys: unknown[] = [];
  server.use(
    http.post(
      "/api/proxy/api/graphs/:graphId/schedules",
      async ({ request }) => {
        const body = (await request.json()) as { schedule_id?: unknown };
        keys.push(body.schedule_id);
        const status = statuses[keys.length - 1] ?? 200;
        if (status === NO_ANSWER) return HttpResponse.error();
        if (status !== 200) {
          return HttpResponse.json({ detail: `HTTP ${status}` }, { status });
        }
        return HttpResponse.json(
          getPostV1CreateExecutionScheduleResponseMock({
            id: String(body.schedule_id),
          }),
        );
      },
    ),
  );
  return keys;
}

function renderModal() {
  return render(
    <>
      <ScheduleAgentModal
        isOpen
        onClose={vi.fn()}
        agent={agent}
        inputValues={{ topic: "news" }}
        inputCredentials={{}}
      />
      <Toaster />
    </>,
  );
}

// Once the previous create has its answer: until then the button is disabled.
async function clickSchedule(
  user: ReturnType<typeof userEvent.setup>,
  keys: unknown[],
) {
  const sent = keys.length;
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Schedule" })).not.toHaveProperty(
      "disabled",
      true,
    ),
  );
  await user.click(screen.getByRole("button", { name: "Schedule" }));
  await waitFor(() => expect(keys).toHaveLength(sent + 1));
}

function sessionStorageValues() {
  const { sessionStorage } = window;
  return Array.from({ length: sessionStorage.length }, (_, index) =>
    sessionStorage.getItem(sessionStorage.key(index) ?? ""),
  );
}

// Until the last create's success is handled, which drops its key, so the
// test leaves nothing in flight.
async function waitForSuccess(keys: unknown[]) {
  // The key must be a real key, and the success must be observed, before its
  // removal means anything: otherwise the wait passes vacuously when nothing
  // was ever stored.
  expect(keys.at(-1)).toMatch(UUID_V4);
  // A success toast must be observed: the wait below passes vacuously when
  // nothing was ever stored, and a second success in the same test leaves
  // two toasts up, so this reads all of them.
  expect(
    (await screen.findAllByText("Schedule created")).length,
  ).toBeGreaterThan(0);
  await waitFor(() =>
    expect(sessionStorageValues()).not.toContain(keys.at(-1)),
  );
}

describe("ScheduleAgentModal retried creates (#16901)", () => {
  test("a create whose answer was lost is sent again with its key, which survives a reload, and a new create after success gets a new one", async () => {
    const user = userEvent.setup();
    const keys = answerCreates([503, 504]);
    const firstTab = renderModal();

    await clickSchedule(user, keys);
    // A reload keeps sessionStorage, and nothing the page held in memory.
    expect(sessionStorageValues()).toContain(keys[0]);
    firstTab.unmount();

    // A real reload: a fresh module registry, with only sessionStorage kept.
    // The in-memory storage overlay from the first tab is gone with it.
    vi.resetModules();
    const { useAuthStore: freshAuthStore } = await import(
      "@/lib/auth/hooks/useAuthStore"
    );
    freshAuthStore.setState({
      user: { id: "user-1", email: "user-1@example.com", user_metadata: {} },
      isUserLoading: false,
      hasLoadedUser: true,
    });
    const { render: freshRender } = await import(
      "@/tests/integrations/test-utils"
    );
    const { ScheduleAgentModal: FreshScheduleAgentModal } = await import(
      "../ScheduleAgentModal"
    );
    const { Toaster: FreshToaster } = await import(
      "@/components/molecules/Toast/toaster"
    );
    freshRender(
      <>
        <FreshScheduleAgentModal
          isOpen
          onClose={vi.fn()}
          agent={agent}
          inputValues={{ topic: "news" }}
          inputCredentials={{}}
        />
        <FreshToaster />
      </>,
    );

    await clickSchedule(user, keys);
    await clickSchedule(user, keys);
    await waitForSuccess(keys);
    await clickSchedule(user, keys);
    await waitForSuccess(keys);

    const [key] = keys;
    expect(key).toMatch(UUID_V4);
    expect(keys.slice(0, 3)).toEqual([key, key, key]);
    expect(keys[3]).toMatch(UUID_V4);
    expect(keys[3]).not.toBe(key);
  });

  test.each([409, 403])(
    "a %i is final, so the next attempt starts over with a new key",
    async (status) => {
      const user = userEvent.setup();
      const keys = answerCreates([status]);
      renderModal();

      await clickSchedule(user, keys);
      await clickSchedule(user, keys);
      await waitForSuccess(keys);

      expect(keys[0]).toMatch(UUID_V4);
      expect(keys[1]).toMatch(UUID_V4);
      expect(keys[1]).not.toBe(keys[0]);
    },
  );

  test("a 400 keeps the create key, so the retry sends the same one", async () => {
    const user = userEvent.setup();
    const keys = answerCreates([400]);
    renderModal();

    await clickSchedule(user, keys);
    await clickSchedule(user, keys);
    await waitForSuccess(keys);

    expect(keys[0]).toMatch(UUID_V4);
    expect(keys[1]).toBe(keys[0]);
  });

  test("keys are made where crypto.randomUUID is missing, as on a self-hosted install served over plain HTTP", async () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: real.getRandomValues.bind(real),
    });
    const user = userEvent.setup();
    const keys = answerCreates([]);
    renderModal();

    await clickSchedule(user, keys);
    await waitForSuccess(keys);

    expect(keys[0]).toMatch(UUID_V4);
  });

  test("a create that got no answer says it may exist, links to the schedules, and keeps its key for the retry", async () => {
    const user = userEvent.setup();
    const keys = answerCreates([NO_ANSWER]);
    renderModal();

    await clickSchedule(user, keys);

    expect(
      await screen.findByText(
        "We couldn't confirm the schedule was saved, so it may already exist. Check your schedules before trying again.",
      ),
    ).toBeDefined();
    expect(
      (
        await screen.findByRole("link", { name: "View schedules" })
      ).getAttribute("href"),
    ).toBe("/library/followups");
    await clickSchedule(user, keys);
    await waitForSuccess(keys);
    expect(keys[1]).toBe(keys[0]);
  });
});
