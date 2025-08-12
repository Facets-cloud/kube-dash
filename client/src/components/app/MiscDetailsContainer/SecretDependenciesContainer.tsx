import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ExternalLinkIcon } from "@radix-ui/react-icons";
import { createEventStreamQueryObject, getEventStreamUrl } from "@/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import { kwDetails, appRoute } from "@/routes";
import { memo } from "react";
import { updateSecretDependencies } from "@/data/Configurations/Secrets/SecretDependenciesSlice";
import { useEventSource } from "@/components/app/Common/Hooks/EventSource";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { SECRET_ENDPOINT_SINGULAR } from "@/constants";
import type { SecretDependencies, DependencyResource } from "@/data/Configurations/Secrets/SecretDependenciesSlice";

const SecretDependenciesContainer = memo(function () {
  const { config } = appRoute.useParams();
  const { cluster, resourcename, namespace } = kwDetails.useSearch();
  const {
    loading,
    secretDependencies
  } = useAppSelector((state) => state.secretDependencies);
  const dispatch = useAppDispatch();
  const navigate = useNavigate();

  const sendMessage = (message: SecretDependencies) => {
    dispatch(updateSecretDependencies(message));
  };

  const handleConfigError = () => {
    toast.error("Configuration Error", {
      description: "The configuration you were viewing has been deleted or is no longer available. Redirecting to configuration page.",
    });
    navigate({ to: '/config' });
  };

  useEventSource({
    url: getEventStreamUrl(
      SECRET_ENDPOINT_SINGULAR,
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

  const hasAnyDependencies = Object.values(secretDependencies).some(deps => Array.isArray(deps) && deps.length > 0);

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
              <p className="text-sm">No workloads are currently using this secret.</p>
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
            Workloads that use this secret:
          </div>
          {renderResourceList("Pods", secretDependencies.pods, "pods")}
          {renderResourceList("Deployments", secretDependencies.deployments, "deployments")}
          {renderResourceList("Jobs", secretDependencies.jobs, "jobs")}
          {renderResourceList("CronJobs", secretDependencies.cronjobs, "cronjobs")}
        </CardContent>
      </Card>
    </div>
  );
});

export {
  SecretDependenciesContainer
};