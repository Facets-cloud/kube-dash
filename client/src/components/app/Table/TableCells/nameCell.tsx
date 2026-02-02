import { Link } from "@tanstack/react-router";
import { memo } from "react";

type NameCellProps = {
  cellValue: string;
  link: string;
  badges?: Array<{
    label: string;
    variant: 'schedulable' | 'cordoned' | 'critical' | 'warning';
  }>;
};


const NameCell = memo(function ({ cellValue, link, badges}: NameCellProps) {

  return (
    <div className="flex items-center gap-2 py-0.5">
      <Link
        to={`/${link}`}
      >
        <span title={cellValue} className="max-w-[750px] text-sm truncate text-blue-600 dark:text-blue-500 hover:underline px-3">
          {cellValue}
        </span>
      </Link>
      {badges && badges.map((badge, index) => (
        <span
          key={index}
          className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
            badge.variant === 'schedulable'
              ? 'bg-green-50 dark:bg-green-950/30 text-green-800 dark:text-green-400 ring-green-600/30 dark:ring-green-400/30'
              : badge.variant === 'cordoned'
              ? 'bg-orange-50 dark:bg-orange-950/30 text-orange-800 dark:text-orange-400 ring-orange-600/30 dark:ring-orange-400/30'
              : badge.variant === 'critical'
              ? 'bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-400 ring-red-600/30 dark:ring-red-400/30'
              : 'bg-yellow-50 dark:bg-yellow-950/30 text-yellow-800 dark:text-yellow-400 ring-yellow-600/30 dark:ring-yellow-400/30'
          }`}
        >
          {badge.label}
        </span>
      ))}
    </div>

  );
});

export {
  NameCell
};