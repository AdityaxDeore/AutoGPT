import { usePostV1CreateExecutionSchedule as useCreateSchedule } from "@/app/api/__generated__/endpoints/schedules/schedules";
import { GraphExecutionJobInfo } from "@/app/api/__generated__/models/graphExecutionJobInfo";
import { LibraryAgent } from "@/app/api/__generated__/models/libraryAgent";
import { useToast } from "@/components/molecules/Toast/use-toast";
import {
  useAuthStore,
  waitForAuthSettled,
} from "@/lib/auth/hooks/useAuthStore";
import { invalidateAllScheduleQueries } from "@/services/schedules/invalidate-schedules";
import { scheduleCreateErrorToast } from "@/services/schedules/schedule-create-error";
import {
  forgetScheduleCreateKey,
  withScheduleCreateKey,
} from "@/services/schedules/schedule-create-key";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

interface UseScheduleAgentModalCallbacks {
  onCreateSchedule?: (schedule: GraphExecutionJobInfo) => void;
  onClose?: () => void;
}

export function useScheduleAgentModal(
  agent: LibraryAgent,
  inputValues: Record<string, any>,
  inputCredentials: Record<string, any>,
  callbacks?: UseScheduleAgentModalCallbacks,
) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const defaultScheduleName = useMemo(() => `Run ${agent.name}`, [agent.name]);
  const [scheduleName, setScheduleName] = useState(defaultScheduleName);
  const [cronExpression, setCronExpression] = useState(
    agent.recommended_schedule_cron || "0 9 * * 1",
  );

  const createScheduleMutation = useCreateSchedule({
    mutation: {
      onSuccess: (response, create) => {
        forgetScheduleCreateKey({
          userId: useAuthStore.getState().user?.id,
          create,
        });
        if (response.status === 200) {
          toast({
            title: "Schedule created",
          });
          callbacks?.onCreateSchedule?.(response.data);
          invalidateAllScheduleQueries(queryClient, agent.graph_id);
          // Reset form
          setScheduleName(defaultScheduleName);
          setCronExpression(agent.recommended_schedule_cron || "0 9 * * 1");
          callbacks?.onClose?.();
        }
      },
      onError: (error: unknown, create) => {
        forgetScheduleCreateKey({
          userId: useAuthStore.getState().user?.id,
          create,
          error,
        });
        // The toast sends the user to check their schedules, so refresh the
        // lists here too: a still-fresh cached list can hide the schedule
        // the first attempt made. The key is kept for a retry (see
        // forgetScheduleCreateKey); a 409 or 403 drops it as final.
        invalidateAllScheduleQueries(queryClient, agent.graph_id);
        toast({
          title: "Failed to create schedule",
          variant: "destructive",
          ...scheduleCreateErrorToast(error),
        });
      },
    },
  });

  const handleSchedule = useCallback(
    async (scheduleName: string, cronExpression: string) => {
      if (!scheduleName.trim()) {
        toast({
          title: "⚠️ Schedule name required",
          description: "Please provide a name for your schedule.",
          variant: "destructive",
        });
        return Promise.reject(new Error("Schedule name required"));
      }

      // Don't send before the signed-in user's id has loaded: the key is
      // hashed with it, and a create sent while it is undefined, then
      // retried after it, uses another slot and can make a second schedule.
      // This waits for loading to settle, not for an id — a failed session
      // load settles with no user, and the create still goes through.
      await waitForAuthSettled();
      const userId = useAuthStore.getState().user?.id;

      return new Promise<void>((resolve, reject) => {
        createScheduleMutation.mutate(
          withScheduleCreateKey({
            userId,
            create: {
              graphId: agent.graph_id,
              data: {
                name: scheduleName,
                cron: cronExpression,
                inputs: inputValues,
                graph_version: agent.graph_version,
                credentials: inputCredentials,
              },
            },
          }),
          {
            onSuccess: () => resolve(),
            onError: (error) => reject(error),
          },
        );
      });
    },
    [
      agent.graph_id,
      agent.graph_version,
      inputValues,
      inputCredentials,
      createScheduleMutation,
      toast,
    ],
  );

  const handleSetScheduleName = useCallback((name: string) => {
    setScheduleName(name);
  }, []);

  const handleSetCronExpression = useCallback((expression: string) => {
    setCronExpression(expression);
  }, []);

  const resetForm = useCallback(() => {
    setScheduleName(defaultScheduleName);
    setCronExpression(agent.recommended_schedule_cron || "0 9 * * 1");
  }, [defaultScheduleName, agent.recommended_schedule_cron]);

  return {
    // State
    scheduleName,
    cronExpression,

    // Loading state
    isCreatingSchedule: createScheduleMutation.isPending,

    // Actions
    handleSchedule,
    handleSetScheduleName,
    handleSetCronExpression,
    resetForm,
  };
}
