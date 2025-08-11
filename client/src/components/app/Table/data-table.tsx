import './index.css';

import {
  ColumnDef,
  ColumnFiltersState,
  FilterFn,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable
} from "@tanstack/react-table";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { useEffect, useState } from "react";

import { DataTableToolbar } from "@/components/app/Table/TableToolbar";
import { RootState } from "@/redux/store";

import { useAppSelector } from "@/redux/hooks";
import { CUSTOM_RESOURCES_LIST_ENDPOINT } from "@/constants";

type DataTableProps<TData, TValue> = {
  columns: ColumnDef<TData, TValue>[];
  data: TData[];
  tableWidthCss: string;
  showNamespaceFilter: boolean;
  instanceType: string;
  showToolbar?: boolean;
  loading?: boolean;
  isEventTable?: boolean;
  connectionStatus?: 'connecting' | 'connected' | 'reconnecting' | 'error';
}

declare global {
  interface Window {
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    safari:any;
    /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
    lastSelectedRow: any;
  }
}


// eslint-disable-next-line  @typescript-eslint/no-explicit-any
const fuzzyFilter: FilterFn<any> = (row, columnId, value, addMeta) => {
  const rowValue = row.getValue(columnId) as string;

  const isMatch = rowValue.toLowerCase().includes(value.toLowerCase());

  addMeta({
    isMatch,
  });

  return isMatch;
};

export function DataTable<TData, TValue>({
  columns,
  data,
  tableWidthCss,
  showNamespaceFilter,
  instanceType,
  showToolbar = true,
  loading = false,
  isEventTable = false,
  connectionStatus = 'connected',
}: DataTableProps<TData, TValue>) {

  const {
    searchString
  } = useAppSelector((state: RootState) => state.listTableFilter);
  const {
    selectedNamespace
  } = useAppSelector((state: RootState) => state.listTableNamesapce);

  const getDefaultValue = () => {
    if (selectedNamespace.length > 0) {
      return [{
        id: 'Namespace',
        value: Array.from(selectedNamespace)
      }];
    }
    return [];
  };
  const [rowSelection, setRowSelection] = useState({});
  const [globalFilter, setGlobalFilter] = useState(searchString);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>(getDefaultValue());
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>({});
  const table = useReactTable({
    data,
    state: {
      globalFilter,
      columnFilters,
      columnVisibility,
      rowSelection
    },
    columns,
    enableRowSelection: true,
    globalFilterFn: fuzzyFilter,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setGlobalFilter,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    getRowId: row => row?.uid || row?.metadata?.uid,
  });

  const getIdAndSetClass = (shouldSetClass: boolean, id: string) => {
    const safeId = typeof id === 'string' ? id : '';
    if (shouldSetClass && safeId) {
      setTimeout(() => {
        document.getElementById(safeId)?.classList.remove("table-row-bg");
      }, 2000);
      document.getElementById(safeId)?.classList.add("table-row-bg");
    }
    return safeId;
  };
  useEffect(() => {
    setRowSelection({});
  }, [instanceType]);

  const emptyMessage = instanceType === CUSTOM_RESOURCES_LIST_ENDPOINT
    ? 'No resources found for this Custom Resource Definition.'
    : 'No results.';

  return (
    <>
      {
        showToolbar
        && <DataTableToolbar loading={loading} table={table} globalFilter={globalFilter} setGlobalFilter={setGlobalFilter} showNamespaceFilter={showNamespaceFilter} connectionStatus={connectionStatus} />
      }
      {
         
        window.safari !== undefined && 
        <div className='flex bg-red-500 dark:bg-red-900 items-center justify-between text-xs font-light px-2 py-1'>
        <span className='text-xs text-white'>We detected you are on Safari browser and are using http. For seemless expereince switch over to chrome/firefox. More details <a className='underline' href='https://github.com/Facets-cloud/kube-dash' target='blank'>here</a></span>
      </div>
      }
      
      <div className={`border border-x-0 list-table-container ${tableWidthCss}`}>
        <div className="list-table-scrollable">
          <Table>
          <TableHeader className="bg-muted/50">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header, index) => {
                  return (
                    <TableHead key={header.id} colSpan={header.colSpan} className={index === 0 ? 'w-px' : ''}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                    </TableHead>
                  );
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows?.length ? (
              table.getRowModel().rows.map((row) => (
                <TableRow
                  key={row.id}
                  id={getIdAndSetClass(
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (row.original as any)?.hasUpdated,
                    // Prefer metadata.name for objects that don't have top-level name
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    (row.original as any)?.name || (row.original as any)?.metadata?.name || ''
                  )}
                  data-state={row.getIsSelected() && 'selected'}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(
                        cell.column.columnDef.cell,
                        cell.getContext()
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow className={isEventTable ? 'empty-table-events' : 'empty-table'}>
                <TableCell
                  colSpan={columns.length}
                  className="text-center"
                >
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        </div>
      </div>
    </>
  );
} 