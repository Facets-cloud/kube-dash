import './index.css';

import { PodLogsViewer } from "./PodLogsViewer";
import { PodDetails } from '@/types';

type PodLogsProps = {
  namespace: string;
  name: string;
  configName: string;
  clusterName: string;
  podDetails?: PodDetails;
}

const PodLogs = ({ namespace, name, configName, clusterName, podDetails }: PodLogsProps) => {
  return (
    <PodLogsViewer
      podName={name}
      namespace={namespace}
      configName={configName}
      clusterName={clusterName}
      podDetails={podDetails}
      className="h-full"
    />
  );
};

export {
  PodLogs
};