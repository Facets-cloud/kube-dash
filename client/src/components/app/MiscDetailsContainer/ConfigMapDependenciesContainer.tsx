import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { createEventStreamQueryObject, getEventStreamUrl } from "@/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import { kwDetails, appRoute } from "@/routes";
import { memo } from "react";
import { updateConfigMapDependencies } from "@/data/Configurations/ConfigMaps/ConfigMapDependenciesSlice";
import { useEventSource } from "@/components/app/Common/Hooks/EventSource";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { CONFIG_MAPS_ENDPOINT } from "@/constants";
import type { ConfigMapDependencies, DependencyResource } from "@/data/Configurations/ConfigMaps/ConfigMapDependenciesSlice";

const ConfigMapDependenciesContainer = memo(function () {
  const { config } = appRoute.useParams();
  const { cluster, resourcename, namespace } = kwDetails.useSearch();
  const {
    loading,
    configMapDependencies
  } = useAppSelector((state) => state.configMapDependencies);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const sendMessage = (message: ConfigMapDependencies) => {
    dispatch(updateConfigMapDependencies(message));
  };

  const handleConfigError = () => {
    toast.error("Configuration Error", {
      description: "The configuration you were viewing has been deleted or is no longer available. Redirecting to configuration page.",
    });
    navigate({ to: '/config' });
  };

  useEventSource({
    url: getEventStreamUrl(
      CONFIG_MAPS_ENDPOINT,
      createEventStreamQueryObject(
        config,
        cluster,
        namespace
      ),
      `/${resourcename}/dependencies`
    ),
    sendMessage,
    onConfigError: handleConfigError,
  });

  const navigateToResource = (resourceType: string, resourceName: string, resourceNamespace: string) => {
    navigate({ 
      to: `/${config}/details?cluster=${encodeURIComponent(cluster)}&resourcekind=${resourceType}&resourcename=${encodeURIComponent(resourceName)}&namespace=${encodeURIComponent(resourceNamespace)}` 
    });
  };

  const renderResourceList = (title: string, resources: DependencyResource[] | undefined, resourceType: string) => {
    if (!resources || resources.length === 0) return null;

    return (
      <Card className="shadow-none rounded-lg mt-4">
        <CardHeader className="p-4">
          <CardTitle className="text-sm font-medium flex items-center justify-between">
            {title}
            <Badge variant="secondary" className="text-xs">
              {resources.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <div className="space-y-2">
            {resources.map((resource, index) => (
              <div key={index} className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex flex-col">
                  <span className="font-medium text-sm">{resource.name}</span>
                  <span className="text-xs text-muted-foreground">
                    Namespace: {resource.namespace}
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => navigateToResource(resourceType, resource.name, resource.namespace)}
                  className="h-8 w-8 p-0"
                >
                  <ExternalLinkIcon className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  };

  const hasAnyDependencies = Object.values(configMapDependencies).some(deps => Array.isArray(deps) && deps.length > 0);

  if (loading) {
    return (
      <div className="mt-4">
        <Card className="shadow-none rounded-lg">
          <CardHeader className="p-4">
            <CardTitle className="text-sm font-medium">Dependencies</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="animate-pulse space-y-2">
              <div className="h-4 bg-muted rounded w-3/4"></div>
              <div className="h-4 bg-muted rounded w-1/2"></div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!hasAnyDependencies) {
    return (
      <div className="mt-4">
        <Card className="shadow-none rounded-lg">
          <CardHeader className="p-4">
            <CardTitle className="text-sm font-medium">Dependencies</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="text-center py-8 text-muted-foreground">
              <p className="text-sm">No workloads are currently using this configmap.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mt-4">
      <Card className="shadow-none rounded-lg">
        <CardHeader className="p-4">
          <CardTitle className="text-sm font-medium">Dependencies</CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <div className="text-sm text-muted-foreground mb-4">
            Workloads that use this configmap:
          </div>
          {renderResourceList("Pods", configMapDependencies.pods, "pods")}
          {renderResourceList("Deployments", configMapDependencies.deployments, "deployments")}
          {renderResourceList("Jobs", configMapDependencies.jobs, "jobs")}
          {renderResourceList("CronJobs", configMapDependencies.cronjobs, "cronjobs")}
        </CardContent>
      </Card>
    </div>
  );
});

export {
  ConfigMapDependenciesContainer
};