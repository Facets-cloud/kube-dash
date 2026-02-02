import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, AlertTriangle } from "lucide-react";
import { DataTable } from "@/components/app/Table";
import { HeaderList, Pods } from "@/types";
import { createEventStreamQueryObject, defaultSkeletonRow, getEventStreamUrl } from "@/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import { formatBytes, parseKubernetesQuantity } from "@/utils/Clusters/NodeUtils";

import { CopyToClipboard } from "@/components/app/Common/CopyToClipboard";
import { defaultOrValue } from "@/utils";
import { memo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { kwDetails, appRoute } from "@/routes";
import { podsColumnConfig } from "@/utils/ListType/ListDefinations";
import { updateNodePods } from "@/data/Clusters/Nodes/NodePodsSlice";
import { useEventSource } from "@/components/app/Common/Hooks/EventSource";
import useGenerateColumns from "@/components/app/Common/Hooks/TableColumns";
import { useSidebar } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { NODES_ENDPOINT, PODS_ENDPOINT } from "@/constants";
import { toast } from "sonner";

const NodeDetailsContainer = memo(function () {
  const { config } = appRoute.useParams();
  const { cluster, resourcename } = kwDetails.useSearch();
  const navigate = useNavigate();
  const {
    nodeDetails: {
      status: {
        conditions,
        images,
        issues,
        capacity,
        allocatable
      }
    }
  } = useAppSelector((state) => state.nodeDetails);
  const {
    loading,
    nodePodDetails
  } = useAppSelector((state) => state.nodePods);
  const { open } = useSidebar();
  const dispatch = useAppDispatch();

  const sendMessage = (message: Pods[]) => {
    dispatch(updateNodePods(message));
  };

  const handleConfigError = () => {
    toast.error("Configuration Error", {
      description: "The configuration you were viewing has been deleted or is no longer available. Redirecting to configuration page.",
    });
    navigate({ to: '/config' });
  };

  useEventSource({
    url: getEventStreamUrl(
      NODES_ENDPOINT,
      createEventStreamQueryObject(
        config,
        cluster
      ),
      `/${resourcename}/pods`
    ),
    sendMessage,
    onConfigError: handleConfigError,
  });

  const handleViewPods = () => {
    navigate({ 
      to: `/${config}/list?cluster=${encodeURIComponent(cluster)}&resourcekind=${PODS_ENDPOINT}&node=${encodeURIComponent(resourcename)}` 
    });
  };

  return (
    <div className="mt-2">
      {issues && issues.length > 0 && (
        <Alert
          variant={issues.some(i => i.severity === 'critical') ? 'destructive' : 'default'}
          className="mb-4"
        >
          {issues.some(i => i.severity === 'critical') ? (
            <AlertCircle className="h-4 w-4" />
          ) : (
            <AlertTriangle className="h-4 w-4" />
          )}
          <AlertTitle className="font-semibold">
            Node Issues Detected
          </AlertTitle>
          <AlertDescription>
            <div className="mt-2 space-y-2">
              {issues.map((issue, index) => (
                <div key={index} className="flex items-start gap-2">
                  <Badge
                    variant={issue.severity === 'critical' ? 'destructive' : 'outline'}
                    className="mt-0.5"
                  >
                    {issue.severity}
                  </Badge>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{issue.type}</div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {issue.message}
                    </div>
                    {issue.reason && (
                      <div className="text-xs text-muted-foreground mt-1">
                        Reason: {issue.reason}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
      {(capacity || allocatable) && (
        <Card className="shadow-none rounded-lg mb-4">
          <CardHeader className="p-4">
            <CardTitle className="text-sm font-medium">Storage Information</CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="grid gap-4 md:grid-cols-2">
              {/* Ephemeral Storage Card */}
              {((capacity && capacity["ephemeral-storage"]) || (allocatable && allocatable["ephemeral-storage"])) && (
                <Card className="shadow-none rounded-lg border-dashed">
                  <CardHeader className="p-4">
                    <CardTitle className="text-sm font-normal">Ephemeral Storage</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {/* Total Capacity Row */}
                    <div className="py-1.5 border-t border-b border-dashed flex flex-row">
                      <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                        Total
                      </div>
                      <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                        <div className="break-all basis-[97%]">
                          {(capacity && capacity["ephemeral-storage"])
                            ? formatBytes(parseKubernetesQuantity(String(capacity["ephemeral-storage"])))
                            : '—'}
                        </div>
                        <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                          <CopyToClipboard val={String(capacity?.["ephemeral-storage"] || '')} />
                        </div>
                      </div>
                    </div>
                    {/* Used Row */}
                    {(capacity && capacity["ephemeral-storage"] && allocatable && allocatable["ephemeral-storage"]) && (
                      <div className="py-1.5 border-b border-dashed flex flex-row">
                        <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                          Used
                        </div>
                        <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                          <div className="break-all basis-[97%]">
                            {formatBytes(
                              parseKubernetesQuantity(String(capacity["ephemeral-storage"])) -
                              parseKubernetesQuantity(String(allocatable["ephemeral-storage"]))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Available Row */}
                    <div className="py-1.5 border-b border-dashed flex flex-row">
                      <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                        Available
                      </div>
                      <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                        <div className="break-all basis-[97%]">
                          {(allocatable && allocatable["ephemeral-storage"])
                            ? formatBytes(parseKubernetesQuantity(String(allocatable["ephemeral-storage"])))
                            : '—'}
                        </div>
                        <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                          <CopyToClipboard val={String(allocatable?.["ephemeral-storage"] || '')} />
                        </div>
                      </div>
                    </div>
                    {/* Usage Percentage Row */}
                    {(capacity && capacity["ephemeral-storage"] && allocatable && allocatable["ephemeral-storage"]) && (
                      <div className="py-1.5 border-b border-dashed flex flex-row">
                        <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                          Usage
                        </div>
                        <div className="flex flex-row text-sm font-normal basis-2/3">
                          <div className="break-all">
                            {Math.round(
                              ((parseKubernetesQuantity(String(capacity["ephemeral-storage"])) -
                                parseKubernetesQuantity(String(allocatable["ephemeral-storage"]))) /
                               parseKubernetesQuantity(String(capacity["ephemeral-storage"]))) * 100
                            )}%
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Regular Storage Card */}
              {((capacity && capacity.storage) || (allocatable && allocatable.storage)) && (
                <Card className="shadow-none rounded-lg border-dashed">
                  <CardHeader className="p-4">
                    <CardTitle className="text-sm font-normal">Storage</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    {/* Total Capacity Row */}
                    <div className="py-1.5 border-t border-b border-dashed flex flex-row">
                      <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                        Total
                      </div>
                      <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                        <div className="break-all basis-[97%]">
                          {(capacity && capacity.storage)
                            ? formatBytes(parseKubernetesQuantity(String(capacity.storage)))
                            : '—'}
                        </div>
                        <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                          <CopyToClipboard val={String(capacity?.storage || '')} />
                        </div>
                      </div>
                    </div>
                    {/* Used Row */}
                    {(capacity && capacity.storage && allocatable && allocatable.storage) && (
                      <div className="py-1.5 border-b border-dashed flex flex-row">
                        <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                          Used
                        </div>
                        <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                          <div className="break-all basis-[97%]">
                            {formatBytes(
                              parseKubernetesQuantity(String(capacity.storage)) -
                              parseKubernetesQuantity(String(allocatable.storage))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Available Row */}
                    <div className="py-1.5 border-b border-dashed flex flex-row">
                      <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                        Available
                      </div>
                      <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                        <div className="break-all basis-[97%]">
                          {(allocatable && allocatable.storage)
                            ? formatBytes(parseKubernetesQuantity(String(allocatable.storage)))
                            : '—'}
                        </div>
                        <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                          <CopyToClipboard val={String(allocatable?.storage || '')} />
                        </div>
                      </div>
                    </div>
                    {/* Usage Percentage Row */}
                    {(capacity && capacity.storage && allocatable && allocatable.storage) && (
                      <div className="py-1.5 border-b border-dashed flex flex-row">
                        <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">
                          Usage
                        </div>
                        <div className="flex flex-row text-sm font-normal basis-2/3">
                          <div className="break-all">
                            {Math.round(
                              ((parseKubernetesQuantity(String(capacity.storage)) -
                                parseKubernetesQuantity(String(allocatable.storage))) /
                               parseKubernetesQuantity(String(capacity.storage))) * 100
                            )}%
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}
            </div>
          </CardContent>
        </Card>
      )}
      {
        images && <Card className="shadow-none rounded-lg">
          <CardHeader className="p-4 ">
            <CardTitle className="text-sm font-medium">Images <span className="text-xs">({images?.length})</span></CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="items-start gap-6 rounded-lg grid">
              {
                images?.map((image) => {
                  return (
                    <div key={image?.sizeBytes} className="grid items-start">
                      <Card className="shadow-none rounded-lg border-dashed">
                        {/* <CardHeader className="p-5">
                        <CardTitle className="flex items-center justify-between">
                          <div className="flex flex-1 items-center">
                            <div className="text-sm font-normal basis-2/3 break-all">{image?.type}</div>
                          </div>
                        </CardTitle>
                      </CardHeader> */}
                        <CardContent className="boder p-0">
                          <div className="py-1.5 border-t border-b border-dashed flex flex-row">
                            <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">Size</div>
                            <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                              <div className="break-all basis-[97%] ">
                                {defaultOrValue((Number(image?.sizeBytes) / 1048576).toFixed(2))} MB
                              </div>
                              <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                                <CopyToClipboard val={defaultOrValue((Number(image?.sizeBytes) / 1048576).toFixed(2)) + ' MB'} />
                              </div>
                            </div>
                          </div>
                          {
                            image?.names?.map((imageName) => {
                              return (
                                <div className="py-1.5 border-b border-dashed flex flex-row">
                                  <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">Image Name</div>
                                  <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                                    <div className="break-all basis-[97%] ">
                                      {
                                        defaultOrValue(imageName)
                                      }
                                    </div>
                                    <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                                      <CopyToClipboard val={defaultOrValue(imageName)} />
                                    </div>
                                  </div>
                                </div>
                              );
                            })
                          }
                        </CardContent>
                      </Card>
                    </div>
                  );
                })
              }
            </div>
          </CardContent>
        </Card>
      }
      {
        conditions && <Card className="mt-4 shadow-none rounded-lg">
          <CardHeader className="p-4 ">
            <CardTitle className="text-sm font-medium">Conditions <span className="text-xs">({conditions?.length})</span></CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <div className="items-start gap-6 rounded-lg lg:grid-cols-2 grid">
              {
                conditions?.map((condition) => {
                  return (
                    <div key={condition?.type} className="grid items-start">
                      <Card className="shadow-none rounded-lg border-dashed">
                        <CardHeader className="p-5">
                          <CardTitle className="flex items-center justify-between">
                            <div className="flex flex-1 items-center">
                              {/* <CubeIcon className="mr-2 h-3.5 w-3.5" /> */}
                              <div className="text-sm font-normal basis-2/3 break-all">{condition?.type}</div>
                            </div>
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="boder p-0">
                          <div className="py-1.5 border-t border-b border-dashed flex flex-row">
                            <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">Status</div>
                            <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                              <div className="break-all basis-[97%] ">
                                {defaultOrValue(condition?.status)}
                              </div>
                              <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                                <CopyToClipboard val={defaultOrValue(condition?.status)} />
                              </div>
                            </div>
                          </div>
                          <div className="py-1.5  border-b border-dashed flex flex-row">
                            <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">Last Heartbeat Time</div>
                            <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                              <div className="break-all basis-[97%] ">
                                {
                                  defaultOrValue(condition?.lastHeartbeatTime)
                                }
                              </div>
                              <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                                <CopyToClipboard val={defaultOrValue(condition?.lastHeartbeatTime)} />
                              </div>
                            </div>
                          </div>
                          <div className="py-1.5  border-b border-dashed flex flex-row">
                            <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">Last Transition Time</div>
                            <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                              <div className="break-all basis-[97%] ">
                                {
                                  defaultOrValue(condition?.lastTransitionTime)
                                }
                              </div>
                              <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                                <CopyToClipboard val={defaultOrValue(condition?.lastTransitionTime)} />
                              </div>
                            </div>
                          </div>
                          <div className="py-1.5  border-b border-dashed flex flex-row">
                            <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">Reason</div>
                            <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                              <div className="break-all basis-[97%] ">
                                {
                                  defaultOrValue(condition?.reason)
                                }
                              </div>
                              <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                                <CopyToClipboard val={defaultOrValue(condition?.reason)} />
                              </div>
                            </div>
                          </div>
                          <div className="py-1.5  border-b border-dashed flex flex-row">
                            <div className="pl-4 text-sm font-medium text-muted-foreground basis-1/3">Message</div>
                            <div className="flex flex-row text-sm font-normal basis-2/3 group/item">
                              <div className="break-all basis-[97%] ">
                                {
                                  defaultOrValue(condition?.message)
                                }
                              </div>
                              <div className="basis-[3%] group/edit invisible group-hover/item:visible flex items-center">
                                <CopyToClipboard val={defaultOrValue(condition?.message)} />
                              </div>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  );
                })
              }
            </div>
          </CardContent>
        </Card>
      }

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
                      count: nodePodDetails.length,
                    })
                  }
                  data={loading ? defaultSkeletonRow() : nodePodDetails}
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

    </div>
  );
});

export {
  NodeDetailsContainer
};