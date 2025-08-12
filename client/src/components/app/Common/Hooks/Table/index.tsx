import { ClusterDetails, HeaderList } from "@/types";
import { defaultSkeletonRow, getEventStreamUrl } from "@/utils";
import { PODS_ENDPOINT } from "@/constants";

import { ActionCreatorWithPayload } from "@reduxjs/toolkit";
import { DataTable } from "@/components/app/Table";
import { cn } from "@/lib/utils";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import { RootState } from "@/redux/store";
import { useEventSource } from "../EventSource";
import useGenerateColumns from "../TableColumns";
import { useSidebar } from "@/components/ui/sidebar";
import { useState, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { setPermissionError, clearPermissionError } from '@/data/PermissionErrors/PermissionErrorsSlice';


type CreateTableProps<T, C extends HeaderList> = {
  clusterName: string;
  configName: string;
  loading: boolean;
  headersList: C[];
  instanceType: string;
  count: number;
  data: T[];
  endpoint: string;
  queryParmObject: Record<string, string>;
  // eslint-disable-next-line  @typescript-eslint/no-explicit-any
  dispatchMethod: ActionCreatorWithPayload<any, string>;
  showNamespaceFilter: boolean;
  setLoading?: (loading: boolean) => void;
};

const CreateTable = <T extends ClusterDetails, C extends HeaderList>({
  clusterName,
  configName,
  loading,
  headersList,
  count,
  instanceType,
  data,
  endpoint,
  queryParmObject,
  dispatchMethod,
  showNamespaceFilter,
  setLoading,
}: CreateTableProps<T, C>) => {

  const dispatch = useAppDispatch();
  const navigate = useNavigate();
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'error'>('connecting');
  
  const sendMessage = (message: any[]) => {
    dispatch(dispatchMethod(message));
  };

  const handleConfigError = () => {
    toast.error("Configuration Error", {
      description: "The configuration you were viewing has been deleted or is no longer available. Redirecting to configuration page.",
    });
    navigate({ to: '/config' });
  };

  const handlePermissionError = (error: any) => {
    console.log('Permission error handled in Table component:', error);
    // Dispatch to Redux state to show as full page error in main App component
    dispatch(setPermissionError(error));
    
    // Set loading to false when we get a permission error
    if (setLoading) {
      setLoading(false);
    }
  };

  // Clear permission errors when the endpoint changes (new resource loaded)
  useEffect(() => {
    dispatch(clearPermissionError());
    // Force a small delay to ensure the permission error state is cleared before new requests
    const timer = setTimeout(() => {
      // This ensures the EventSource hook resets properly
    }, 100);
    return () => clearTimeout(timer);
  }, [endpoint, dispatch]);

  const refreshNonce = useAppSelector((state: RootState) => (state as any).listTableRefresh?.refreshNonce);

  // Append refresh nonce to force SSE reconnect and reload data after deletes
  const sseUrl = getEventStreamUrl(endpoint, queryParmObject, '', refreshNonce ? `&r=${refreshNonce}` : '');

  useEventSource<any[]>({
    url: sseUrl,
    sendMessage,
    onConnectionStatusChange: setConnectionStatus,
    onConfigError: handleConfigError,
    onPermissionError: handlePermissionError,
    setLoading,
  });


  const { open, isMobile } = useSidebar();

  const getTableClasses = () => {
    if(isMobile) {
        return 'list-table-max-width-collapsed-mobile';
    } else {
      if (open) {
        return 'list-table-max-width-expanded';
      }
      return 'list-table-max-width-collapsed';
    }
  };

  // Always generate columns to maintain consistent hook order across renders
  const columns = useGenerateColumns<T, C>({
    clusterName,
    configName,
    loading,
    headersList,
    instanceType,
    count,
    queryParams: new URLSearchParams(queryParmObject).toString()
  });

  return (
    <div className="col-span-7 h-full">
      <div className="list-table-container">
        <DataTable<T, C>
          columns={columns}
          data={loading ? defaultSkeletonRow() : data}
          showNamespaceFilter={showNamespaceFilter}
          showPodFilters={endpoint === PODS_ENDPOINT}
          tableWidthCss={cn('list-table-max-width-height', getTableClasses())}
          instanceType={instanceType}
          loading={loading}
          connectionStatus={connectionStatus}
        />
      </div>
    </div>
  );
};

export { CreateTable };
