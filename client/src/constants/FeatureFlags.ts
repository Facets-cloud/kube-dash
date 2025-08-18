import { fetchRuntimeFeatureFlagsWithCache, type FeatureFlagsResponse } from '../data/FeatureFlags/featureFlagsService';

// Feature flags configuration
// These flags control the visibility and availability of various features

export interface FeatureFlags {
  ENABLE_TRACING: boolean;
  // Add more feature flags here as needed
}

// Get build-time feature flag value from environment variables with fallback to default
const getBuildTimeFeatureFlag = (key: keyof FeatureFlags, defaultValue: boolean): boolean => {
  const envValue = import.meta.env[`VITE_${key}`];
  if (envValue === undefined) {
    return defaultValue;
  }
  return envValue === 'true' || envValue === '1';
};

// Build-time feature flags configuration (fallback)
export const BUILD_TIME_FEATURE_FLAGS: FeatureFlags = {
  ENABLE_TRACING: getBuildTimeFeatureFlag('ENABLE_TRACING', false), // Default to false
};

// Runtime feature flags (will be populated by the hook)
let runtimeFeatureFlags: FeatureFlags | null = null;

// Set runtime feature flags (called by the hook)
export const setRuntimeFeatureFlags = (flags: FeatureFlagsResponse): void => {
  runtimeFeatureFlags = {
    ENABLE_TRACING: flags.enableTracing,
  };
};

// Helper function to check if a feature is enabled
// Priority: Runtime flags > Build-time flags
export const isFeatureEnabled = (feature: keyof FeatureFlags): boolean => {
  // Use runtime flags if available
  if (runtimeFeatureFlags) {
    return runtimeFeatureFlags[feature];
  }
  
  // Fallback to build-time flags
  return BUILD_TIME_FEATURE_FLAGS[feature];
};

// Get current feature flags (runtime if available, otherwise build-time)
export const getCurrentFeatureFlags = (): FeatureFlags => {
  return runtimeFeatureFlags || BUILD_TIME_FEATURE_FLAGS;
};

// Export individual flags for convenience (these will use the priority system)
export const getEnableTracing = (): boolean => isFeatureEnabled('ENABLE_TRACING');

// Async function to fetch and apply runtime feature flags
export const initializeRuntimeFeatureFlags = async (): Promise<FeatureFlags> => {
  try {
    const runtimeFlags = await fetchRuntimeFeatureFlagsWithCache();
    setRuntimeFeatureFlags(runtimeFlags);
    return getCurrentFeatureFlags();
  } catch (error) {
    console.warn('Failed to initialize runtime feature flags, using build-time flags:', error);
    return BUILD_TIME_FEATURE_FLAGS;
  }
};