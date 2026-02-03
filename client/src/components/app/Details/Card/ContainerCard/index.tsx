import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { ContainerCardProps } from "@/types";
import { CubeIcon } from "@radix-ui/react-icons";
import { defaultOrValue } from "@/utils";

// Get the status badge for a container based on its state
function getContainerStatusBadges(containerData: ContainerCardProps) {
  const { state, exitCode, terminationReason, started, ready } = containerData;

  // Terminated state - check if completed successfully or with error
  if (state === 'terminated') {
    const isSuccess = exitCode === 0;
    if (isSuccess) {
      return (
        <>
          <Badge variant="default" className="mr-1">Completed</Badge>
          <Badge variant="outline">Exit 0</Badge>
        </>
      );
    } else {
      return (
        <>
          <Badge variant="destructive" className="mr-1">
            {terminationReason || 'Terminated'}
          </Badge>
          <Badge variant="outline">Exit {exitCode ?? '?'}</Badge>
        </>
      );
    }
  }

  // Running state
  if (state === 'running') {
    return (
      <>
        <Badge variant="default" className="mr-1">Running</Badge>
        <Badge variant={ready ? 'default' : 'outline'} className="mr-1">
          {ready ? 'Ready' : 'Not Ready'}
        </Badge>
      </>
    );
  }

  // Waiting state
  if (state === 'waiting') {
    return (
      <>
        <Badge variant="outline" className="mr-1">Waiting</Badge>
        <Badge variant="outline">Not Ready</Badge>
      </>
    );
  }

  // Fallback to legacy behavior for unknown state
  return (
    <>
      <span className={started ? 'text-emerald-400' : 'text-red-400'}>
        {!started ? 'Not ' : ''}Started
      </span>
      <span className={`pl-1 ${ready ? 'text-emerald-300' : 'text-red-300'}`}>
        {!ready ? 'Not ' : ''}Ready
      </span>
    </>
  );
}

export function ContainerCard(containerData: ContainerCardProps) {
  const {
    name,
    image,
    imagePullPolicy,
    lastRestart,
    restartReason,
    restarts,
    terminationMessagePolicy
  } = containerData;
  return (
    <Card className="shadow-none rounded-lg border-dashed">
      <CardHeader className="border-b pb-2">
        <CardTitle>{name}</CardTitle>
        <CardDescription className="flex items-center">
          <CubeIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground/70" />
          {image}
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 pt-4">
        <div className="p-2 -mx-2 flex items-start space-x-4 rounded-md p-2 transition-all">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Status</p>
            <p className="text-sm font-medium leading-none flex items-center flex-wrap gap-1">
              {getContainerStatusBadges(containerData)}
            </p>
          </div>
        </div>
        <div className="-mx-2 flex items-start space-x-4 rounded-md p-2 transition-all">
          <div className="space-y-1">
            <p className="text-sm text-muted-foreground">Restart Reason</p>
            <p className="text-sm font-medium leading-none">{defaultOrValue(restartReason)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="-mx-2 flex items-start space-x-4 rounded-md p-2 transition-all">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Restarts</p>
              <p className="text-sm font-medium leading-none">{defaultOrValue(restarts)}</p>
            </div>
          </div>
          <div className="-mx-2 flex items-start space-x-4 rounded-md p-2 transition-all">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Last Restart</p>
              <p className="text-sm font-medium leading-none">{defaultOrValue(lastRestart)}</p>
            </div>
          </div>
          <div className="-mx-2 flex items-start space-x-4 rounded-md p-2 transition-all">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Image Pull Policy</p>
              <p className="text-sm font-medium leading-none">{defaultOrValue(imagePullPolicy)}</p>
            </div>
          </div>
          <div className="-mx-2 flex items-start space-x-4 rounded-md p-2 transition-all">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Termination Message Policy</p>
              <p className="text-sm font-medium leading-none">{defaultOrValue(terminationMessagePolicy)}</p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
