import React, { useEffect, useState } from 'react';
import { AlertCircle, XCircle, CheckCircle, Info, Clock, RotateCw } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { cn } from '@/lib/utils';
import type { ContainerRestartInfo as RestartInfo } from '@/types';

interface ContainerRestartInfoProps {
  podName: string;
  namespace: string;
  configName: string;
  clusterName: string;
  containerName?: string; // If provided, show only this container's info
  className?: string;
}

const getExitCodeBadge = (exitCode: number) => {
  if (exitCode === 0) {
    return <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Exit 0</Badge>;
  } else if (exitCode === 137) {
    return <Badge variant="destructive">OOMKilled (137)</Badge>;
  } else if (exitCode === 143) {
    return <Badge variant="outline" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">SIGTERM (143)</Badge>;
  } else {
    return <Badge variant="destructive">Exit {exitCode}</Badge>;
  }
};

const getReasonBadge = (reason: string) => {
  const reasonLower = reason.toLowerCase();

  if (reasonLower.includes('oom')) {
    return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="w-3 h-3" />OOMKilled</Badge>;
  } else if (reasonLower.includes('error')) {
    return <Badge variant="destructive" className="flex items-center gap-1"><XCircle className="w-3 h-3" />{reason}</Badge>;
  } else if (reasonLower.includes('completed')) {
    return <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300 flex items-center gap-1"><CheckCircle className="w-3 h-3" />{reason}</Badge>;
  } else {
    return <Badge variant="outline" className="flex items-center gap-1"><Info className="w-3 h-3" />{reason}</Badge>;
  }
};

const formatTimestamp = (timestamp?: string) => {
  if (!timestamp) return 'N/A';
  try {
    const date = new Date(timestamp);
    return date.toLocaleString();
  } catch {
    return timestamp;
  }
};

const calculateDuration = (startedAt?: string, finishedAt?: string) => {
  if (!startedAt || !finishedAt) return null;

  try {
    const start = new Date(startedAt).getTime();
    const finish = new Date(finishedAt).getTime();
    const durationMs = finish - start;

    if (durationMs < 1000) return `${durationMs}ms`;
    if (durationMs < 60000) return `${Math.floor(durationMs / 1000)}s`;
    if (durationMs < 3600000) return `${Math.floor(durationMs / 60000)}m`;
    return `${Math.floor(durationMs / 3600000)}h`;
  } catch {
    return null;
  }
};

export const ContainerRestartInfoComponent: React.FC<ContainerRestartInfoProps> = ({
  podName,
  namespace,
  configName,
  clusterName,
  containerName,
  className,
}) => {
  const [restartInfos, setRestartInfos] = useState<RestartInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRestartInfo = async () => {
      try {
        setLoading(true);
        setError(null);

        const params = new URLSearchParams({
          config: configName,
          cluster: clusterName,
        });

        const response = await fetch(
          `/api/v1/pods/${namespace}/${podName}/restarts?${params.toString()}`
        );

        if (!response.ok) {
          throw new Error(`Failed to fetch restart info: ${response.statusText}`);
        }

        const data: RestartInfo[] = await response.json();
        setRestartInfos(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
      } finally {
        setLoading(false);
      }
    };

    fetchRestartInfo();
  }, [podName, namespace, configName, clusterName]);

  // Filter by container name if provided
  const filteredInfos = containerName
    ? restartInfos.filter(info => info.containerName === containerName)
    : restartInfos;

  // Check if any containers have restarts
  const hasRestarts = filteredInfos.some(info => info.restartCount > 0);

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center p-4', className)}>
        <div className="text-sm text-muted-foreground">Loading restart information...</div>
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive" className={className}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>{error}</AlertDescription>
      </Alert>
    );
  }

  if (filteredInfos.length === 0) {
    return (
      <div className={cn('flex items-center justify-center p-4', className)}>
        <div className="text-sm text-muted-foreground">No container information available</div>
      </div>
    );
  }

  if (!hasRestarts) {
    return (
      <Alert className={className}>
        <CheckCircle className="h-4 w-4 text-green-600" />
        <AlertTitle>No Restarts</AlertTitle>
        <AlertDescription>
          {filteredInfos.length === 1
            ? 'This container has not restarted.'
            : 'None of the containers have restarted.'}
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {filteredInfos.map((info) => {
        if (info.restartCount === 0) return null;

        return (
          <Card key={info.containerName} className="border-l-4 border-l-yellow-500">
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center gap-2">
                  <RotateCw className="w-4 h-4" />
                  {info.containerName}
                </CardTitle>
                <Badge variant="outline" className="bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">
                  {info.restartCount} {info.restartCount === 1 ? 'Restart' : 'Restarts'}
                </Badge>
              </div>
            </CardHeader>

            <CardContent className="space-y-4">
              {/* Current State */}
              <div>
                <div className="text-xs font-medium text-muted-foreground mb-2">Current State</div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">
                    {info.currentState.state}
                  </Badge>
                  {info.currentState.startedAt && (
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      Started: {formatTimestamp(info.currentState.startedAt)}
                    </span>
                  )}
                </div>
              </div>

              {/* Last Termination State */}
              {info.lastState && info.lastState.state === 'terminated' && (
                <>
                  <Separator />
                  <div>
                    <div className="text-xs font-medium text-muted-foreground mb-2">Last Termination</div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        {info.lastState.reason && getReasonBadge(info.lastState.reason)}
                        {info.lastState.exitCode !== undefined && getExitCodeBadge(info.lastState.exitCode)}
                      </div>

                      {info.lastState.message && (
                        <Alert className="mt-2">
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription className="text-xs">
                            {info.lastState.message}
                          </AlertDescription>
                        </Alert>
                      )}

                      <div className="grid grid-cols-2 gap-2 text-xs mt-2">
                        {info.lastState.startedAt && (
                          <div>
                            <span className="text-muted-foreground">Started:</span>
                            <div className="font-mono">{formatTimestamp(info.lastState.startedAt)}</div>
                          </div>
                        )}
                        {info.lastState.finishedAt && (
                          <div>
                            <span className="text-muted-foreground">Finished:</span>
                            <div className="font-mono">{formatTimestamp(info.lastState.finishedAt)}</div>
                          </div>
                        )}
                      </div>

                      {calculateDuration(info.lastState.startedAt, info.lastState.finishedAt) && (
                        <div className="text-xs">
                          <span className="text-muted-foreground">Duration:</span>
                          <span className="ml-2 font-medium">
                            {calculateDuration(info.lastState.startedAt, info.lastState.finishedAt)}
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
};
