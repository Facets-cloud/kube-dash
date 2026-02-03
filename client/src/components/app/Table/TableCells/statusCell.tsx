import { Badge } from "@/components/ui/badge";

type StatusCellProps = {
  cellValue: string;
};

// Error statuses indicate a problem that needs attention
const errorStatuses = new Set([
  'CrashLoopBackOff',
  'ImagePullBackOff',
  'ErrImagePull',
  'CreateContainerConfigError',
  'CreateContainerError',
  'OOMKilled',
  'Error',
  'Failed',
  'Unknown',
  'Killing',
  'False',
]);

// Success statuses indicate healthy/normal state
const successStatuses = new Set([
  'Running',
  'Active',
  'Created',
  'Succeeded',
  'True',
]);

function StatusCell({ cellValue }: StatusCellProps) {
  const getStatusBadge = () => {
    if (successStatuses.has(cellValue)) {
      return <Badge variant="default">{cellValue}</Badge>;
    }

    if (errorStatuses.has(cellValue)) {
      return <Badge className="px-4" variant="destructive">{cellValue}</Badge>;
    }

    if (cellValue === 'Terminating') {
      return <Badge className="px-4 bg-purple-500 hover:bg-purple-600 text-white">{cellValue}</Badge>;
    }

    // Default for pending/waiting states (Pending, ContainerCreating, PodInitializing, etc.)
    return <Badge variant="outline">{cellValue}</Badge>;
  };

  return (
    <span className="px-3">
      {getStatusBadge()}
    </span>
  );
}

export {
  StatusCell
};