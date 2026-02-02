import { NodeListResponse, NodeIssue } from "@/types";

/**
 * Parse Kubernetes quantity strings (e.g., "100Gi", "50Ki", "1000000")
 * Supports binary suffixes (Ki, Mi, Gi, Ti, Pi, Ei) and decimal suffixes (k, M, G, T, P, E)
 * Returns the value in bytes
 */
const parseKubernetesQuantity = (quantity: string | number): number => {
  if (!quantity) return 0;

  // If it's already a number, return it
  if (typeof quantity === 'number') return quantity;

  // Convert to string if not already
  const quantityStr = String(quantity);

  // Match number and optional suffix
  const match = quantityStr.match(/^(\d+(?:\.\d+)?)\s*([A-Za-z]*)$/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  const suffix = match[2];

  // Binary suffixes (base 1024)
  const binarySuffixes: { [key: string]: number } = {
    'Ki': 1024,
    'Mi': 1024 ** 2,
    'Gi': 1024 ** 3,
    'Ti': 1024 ** 4,
    'Pi': 1024 ** 5,
    'Ei': 1024 ** 6,
  };

  // Decimal suffixes (base 1000)
  const decimalSuffixes: { [key: string]: number } = {
    'k': 1000,
    'M': 1000 ** 2,
    'G': 1000 ** 3,
    'T': 1000 ** 4,
    'P': 1000 ** 5,
    'E': 1000 ** 6,
  };

  if (binarySuffixes[suffix]) {
    return value * binarySuffixes[suffix];
  } else if (decimalSuffixes[suffix]) {
    return value * decimalSuffixes[suffix];
  }

  // No suffix means bytes
  return value;
};

/**
 * Format bytes to human-readable string (e.g., "50.23 Gi")
 * Uses binary units (Ki, Mi, Gi, Ti, Pi)
 */
const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';

  const units = ['B', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi'];
  const k = 1024;

  let unitIndex = 0;
  let size = bytes;

  while (size >= k && unitIndex < units.length - 1) {
    size /= k;
    unitIndex++;
  }

  // Format with 2 decimal places for non-byte units
  const formatted = unitIndex === 0
    ? size.toString()
    : size.toFixed(2);

  return `${formatted} ${units[unitIndex]}`;
};

/**
 * Format storage for display in the table
 * Returns formatted string like "50Gi / 100Gi" and percentage
 * Shows: used / total (where used = capacity - allocatable)
 */
const formatStorageDisplay = (
  capacity?: string | number,
  allocatable?: string | number
): { formatted: string; percentage: number } => {
  // Handle undefined, null, or empty values
  if (!capacity && !allocatable) {
    return { formatted: 'N/A', percentage: 0 };
  }

  if (!capacity || !allocatable) {
    const value = capacity || allocatable || '';
    const bytes = parseKubernetesQuantity(value);
    if (bytes === 0) {
      return { formatted: 'N/A', percentage: 0 };
    }
    return { formatted: formatBytes(bytes), percentage: 0 };
  }

  const capacityBytes = parseKubernetesQuantity(capacity);
  const allocatableBytes = parseKubernetesQuantity(allocatable);

  if (capacityBytes === 0 && allocatableBytes === 0) {
    return { formatted: 'N/A', percentage: 0 };
  }

  if (capacityBytes === 0) {
    return { formatted: formatBytes(allocatableBytes), percentage: 0 };
  }

  // Calculate used = capacity - allocatable
  const usedBytes = capacityBytes - allocatableBytes;
  const percentage = (usedBytes / capacityBytes) * 100;

  return {
    formatted: `${formatBytes(usedBytes)} / ${formatBytes(capacityBytes)}`,
    percentage: Math.round(percentage),
  };
};

/**
 * Check if node has critical issues
 */
const hasNodeCriticalIssues = (issues?: NodeIssue[]): boolean => {
  if (!issues || issues.length === 0) return false;
  return issues.some(issue => issue.severity === 'critical');
};

/**
 * Get issue summary string
 */
const getNodeIssueSummary = (issues?: NodeIssue[]): string => {
  if (!issues || issues.length === 0) return '';

  const critical = issues.filter(i => i.severity === 'critical').length;
  const warning = issues.filter(i => i.severity === 'warning').length;

  const parts: string[] = [];
  if (critical > 0) parts.push(`${critical} critical`);
  if (warning > 0) parts.push(`${warning} warning`);

  return parts.join(', ');
};

const formatNodeList = (nodes: NodeListResponse[]) => {
  return nodes.map(({age ,name, resourceVersion, roles, spec, status: {nodeInfo, conditionStatus, issues, capacity, allocatable}, uid }) => {
    // Calculate issue-related fields
    const hasIssues: boolean = !!(issues && issues.length > 0);
    const issueCount: number = issues?.length || 0;
    const issueTypes: string[] = issues?.map(issue => issue.type) || [];

    // Calculate storage display (use ephemeralStorage as nodes don't have regular storage)
    const storageInfo = formatStorageDisplay(
      capacity?.ephemeralStorage,
      allocatable?.ephemeralStorage
    );

    return {
      age: age,
      resourceVersion: resourceVersion,
      name: name,
      roles: roles ? roles.join(', ') : '—',
      conditionStatus: conditionStatus,
      architecture: nodeInfo.architecture,
      bootID: nodeInfo.bootID,
      containerRuntimeVersion: nodeInfo.containerRuntimeVersion,
      kernelVersion: nodeInfo.kernelVersion,
      kubeProxyVersion: nodeInfo.kubeProxyVersion,
      kubeletVersion: nodeInfo.kubeletVersion,
      machineID: nodeInfo.machineID,
      operatingSystem: nodeInfo.operatingSystem,
      osImage: nodeInfo.osImage,
      systemUUID: nodeInfo.systemUUID,
      uid: uid,
      hasIssues,
      issueCount,
      issueTypes,
      storage: storageInfo.formatted,
      storagePercentage: storageInfo.percentage,
      unschedulable: spec.unschedulable,
    };
  });
};

export {
  formatBytes,
  formatNodeList,
  formatStorageDisplay,
  getNodeIssueSummary,
  hasNodeCriticalIssues,
  parseKubernetesQuantity,
};
