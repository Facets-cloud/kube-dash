import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/app/Table";
import { HeaderList, Pods } from "@/types";
import { createEventStreamQueryObject, defaultSkeletonRow, getEventStreamUrl } from "@/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";

import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { kwDetails, appRoute } from "@/routes";
import { podsColumnConfig } from "@/utils/ListType/ListDefinations";
import { updateDaemonSetPods } from "@/data/Workloads/DaemonSets/DaemonSetPodsSlice";
import { useEventSource } from "@/components/app/Common/Hooks/EventSource";
import useGenerateColumns from "@/components/app/Common/Hooks/TableColumns";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { DAEMON_SETS_ENDPOINT, PODS_ENDPOINT } from "@/constants";
import { toast } from "sonner";

const DaemonSetDetailsContainer = memo(function () {
  const { config } = appRoute.useParams();
  const { cluster, resourcename, namespace } = kwDetails.useSearch();
  const navigate = useNavigate();
  const {
    loading,
    daemonSetPodDetails
  } = useAppSelector((state) => state.daemonSetPods);
  const { open } = useSidebar();
  const dispatch = useAppDispatch();

  const sendMessage = (message: Pods[]) => {
    dispatch(updateDaemonSetPods(message));
  };

  const handleConfigError = () => {
    toast.error("Configuration Error", {
      description: "The configuration you were viewing has been deleted or is no longer available. Redirecting to configuration page.",
    });
            navigate({ to: '/' });
  };

  useEventSource({
    url: getEventStreamUrl(
      DAEMON_SETS_ENDPOINT,
      createEventStreamQueryObject(
        config,
        cluster,
        namespace
      ),
      `/${namespace}/${resourcename}/pods`
    ),
    sendMessage,
    onConfigError: handleConfigError,
  });

  const handleViewPods = () => {
    navigate({ 
      to: `/${config}/list?cluster=${encodeURIComponent(cluster)}&resourcekind=${PODS_ENDPOINT}&namespace=${encodeURIComponent(namespace || '')}&owner=daemonset&ownerName=${encodeURIComponent(resourcename)}` 
    });
  };

  return (
    <div className="mt-2">
      <Card className="rounded-lg">
        <CardHeader className="p-4 flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Pods</CardTitle>
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleViewPods}
            className="text-xs"
          >
            View All Pods
          </Button>
        </CardHeader>
        <CardContent className="pl-4 pr-4">
          <div className="col-span-7">
            <div className="h-full">
              <DataTable
                columns={
                  useGenerateColumns<Pods, HeaderList>({
                    clusterName: cluster,
                    configName: config,
                    loading,
                    headersList: podsColumnConfig(config, cluster, false).headersList,
                    instanceType: PODS_ENDPOINT,
                    count: daemonSetPodDetails.length,
                  })
                }
                data={loading ? defaultSkeletonRow() : daemonSetPodDetails}
                tableWidthCss={cn("border-r border-l", open ? 'deployment-list-table-max-width-expanded' : 'deployment-list-table-max-width-collapsed')}
                instanceType={PODS_ENDPOINT}
                showToolbar={false}
                showNamespaceFilter={false}
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
});

export {
  DaemonSetDetailsContainer
}; 