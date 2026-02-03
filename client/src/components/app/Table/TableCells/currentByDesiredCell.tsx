import { memo } from "react";

type CurrentByDesiredCellProps = {
  cellValue: string;
  status?: string;
};

// Statuses where 0/X is expected (completed workloads)
const completedStatuses = new Set(['Succeeded', 'Completed']);

const CurrentByDesiredCell = memo(function ({ cellValue, status }: CurrentByDesiredCellProps) {
  const valueArray = cellValue.split('/');
  const isReady = valueArray[0] === valueArray[1];
  const isCompleted = status && completedStatuses.has(status);

  // For completed pods/jobs, grey out the count since 0/X is expected
  const colorClass = isCompleted
    ? 'text-muted-foreground'
    : isReady
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-red-600 dark:text-red-400';

  return (
    <div className="">
      <span className={`text-sm truncate px-3 ${colorClass}`}>
        {cellValue}
      </span>
    </div>
  );
});

export {
  CurrentByDesiredCell
};