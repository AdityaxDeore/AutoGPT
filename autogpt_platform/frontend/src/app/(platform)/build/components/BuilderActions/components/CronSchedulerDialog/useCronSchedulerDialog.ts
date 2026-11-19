import type { ScheduleCreationRequest } from "@/app/api/__generated__/models/scheduleCreationRequest";
import { usePostV1CreateExecutionSchedule } from "@/app/api/__generated__/endpoints/schedules/schedules";
import { useToast } from "@/components/molecules/Toast/use-toast";
import {
  useAuthStore,
  waitForAuthSettled,
} from "@/lib/auth/hooks/useAuthStore";
import { useUserTimezone } from "@/lib/hooks/useUserTimezone";
import { getTimezoneDisplayName } from "@/lib/timezone-utils";
import { invalidateAllScheduleQueries } from "@/services/schedules/invalidate-schedules";
import { scheduleCreateErrorToast } from "@/services/schedules/schedule-create-error";
import {
  forgetScheduleCreateKey,
  withScheduleCreateKey,
} from "@/services/schedules/schedule-create-key";
import { useQueryClient } from "@tanstack/react-query";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useEffect, useState } from "react";

export function useCronSchedulerDialog({
  open,
  setOpen,
  inputs,
  credentials,
  defaultCronExpression = "",
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  inputs: ScheduleCreationRequest["inputs"];
  credentials: ScheduleCreationRequest["credentials"];
  defaultCronExpression?: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [cronExpression, setCronExpression] = useState<string>("");
  const [scheduleName, setScheduleName] = useState<string>("");
  const [scheduleNameError, setScheduleNameError] = useState<string>("");

  const [{ flowID, flowVersion }] = useQueryStates({
    flowID: parseAsString,
    flowVersion: parseAsInteger,
    flowExecutionID: parseAsString,
  });

  const userTimezone = useUserTimezone();
  const timezoneDisplay = getTimezoneDisplayName(userTimezone || "UTC");

  const { mutateAsync: createSchedule, isPending: isCreatingSchedule } =
    usePostV1CreateExecutionSchedule({
      mutation: {
        onSuccess: (response, create) => {
          forgetScheduleCreateKey({
            userId: useAuthStore.getState().user?.id,
            create,
          });
          if (response.status === 200) {
            setOpen(false);
            toast({
              title: "Schedule created",
              description: "Schedule created successfully",
            });
            invalidateAllScheduleQueries(queryClient, flowID ?? undefined);
          }
        },
        onError: (error, create) => {
          forgetScheduleCreateKey({
            userId: useAuthStore.getState().user?.id,
            create,
            error,
          });
          // The toast sends the user to check their schedules, so refresh the
          // lists here too: a still-fresh cached list can hide the schedule
          // the first attempt made. The key is kept for a retry (see
          // forgetScheduleCreateKey); a 409 or 403 drops it as final.
          invalidateAllScheduleQueries(queryClient, flowID ?? undefined);
          toast({
            variant: "destructive",
            title: "Failed to create schedule",
            ...scheduleCreateErrorToast(error),
          });
        },
      },
    });

  useEffect(() => {
    if (open) {
      setCronExpression(defaultCronExpression);
    }
  }, [open, defaultCronExpression]);

  useEffect(() => {
    if (open) {
      setScheduleName("");
      setScheduleNameError("");
    }
  }, [open]);

  function handleScheduleNameChange(name: string) {
    setScheduleName(name);
    if (name.trim() !== "") {
      setScheduleNameError("");
    }
  }

  async function handleCreateSchedule() {
    if (!scheduleName || scheduleName.trim() === "") {
      setScheduleNameError("Schedule name is required");
      toast({
        variant: "destructive",
        title: "Invalid schedule",
        description: "Please enter a schedule name",
      });
      return;
    }

    if (!cronExpression || cronExpression.trim() === "") {
      toast({
        variant: "destructive",
        title: "Invalid schedule",
        description: "Please enter a valid cron expression",
      });
      return;
    }

    // Don't send before the signed-in user's id has loaded: the key is hashed
    // with it, and a create sent while it is undefined, then retried after
    // it, uses another slot and can make a second schedule. This waits for
    // loading to settle, not for an id — a failed session load settles with
    // no user, and the create still goes through.
    await waitForAuthSettled();
    const userId = useAuthStore.getState().user?.id;

    await createSchedule(
      withScheduleCreateKey({
        userId,
        create: {
          graphId: flowID || "",
          data: {
            name: scheduleName.trim(),
            graph_version: flowID ? flowVersion : undefined,
            cron: cronExpression,
            inputs: inputs,
            credentials: credentials,
          },
        },
      }),
    );
  }

  return {
    cronExpression,
    setCronExpression,
    userTimezone,
    timezoneDisplay,
    handleCreateSchedule,
    setScheduleName: handleScheduleNameChange,
    scheduleName,
    scheduleNameError,
    isCreatingSchedule,
  };
}
