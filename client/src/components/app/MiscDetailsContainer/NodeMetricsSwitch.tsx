import { useEffect, useState } from "react";
import kwFetch from "@/data/kwFetch";
import { API_VERSION } from "@/constants";
import { appRoute, kwDetails } from "@/routes";
import NodePrometheusChart from "./NodePrometheusChart";

export default function NodeMetricsSwitch() {
  const { config } = appRoute.useParams();
  const { cluster } = kwDetails.useSearch();
  const [hasProm, setHasProm] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    const url = `${API_VERSION}/metrics/prometheus/availability?config=${encodeURIComponent(config)}&cluster=${encodeURIComponent(cluster)}`;
    kwFetch(url)
      .then((res: any) => {
        if (!active) return;
        setHasProm(Boolean(res?.installed && res?.reachable));
      })
      .catch(() => { if (active) setHasProm(false); });
    return () => { active = false; };
  }, [config, cluster]);

  if (!hasProm) return null;
  return <NodePrometheusChart />;
}


