import { createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import kwFetch from '@/data/kwFetch';
import { API_VERSION } from '@/constants/ApiConstants';

interface HelmActionsState {
  rollbackLoading: boolean;
  testLoading: boolean;
  error: string | null;
  lastAction: string | null;
}

const initialState: HelmActionsState = {
  rollbackLoading: false,
  testLoading: false,
  error: null,
  lastAction: null,
};

// Async thunk for rolling back a Helm release
export const rollbackHelmRelease = createAsyncThunk(
  'helmActions/rollback',
  async ({
    config,
    cluster,
    releaseName,
    namespace,
    revision,
  }: {
    config: string;
    cluster: string;
    releaseName: string;
    namespace: string;
    revision: number;
  }) => {
    const response = await kwFetch(
      `${API_VERSION}/helmreleases/${releaseName}/rollback?config=${config}&cluster=${cluster}&namespace=${namespace}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ revision }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to rollback release');
    }

    return await response.json();
  }
);

// Async thunk for testing a Helm release
export const testHelmRelease = createAsyncThunk(
  'helmActions/test',
  async ({
    config,
    cluster,
    releaseName,
    namespace,
  }: {
    config: string;
    cluster: string;
    releaseName: string;
    namespace: string;
  }) => {
    const response = await kwFetch(
      `${API_VERSION}/helmreleases/${releaseName}/test?config=${config}&cluster=${cluster}&namespace=${namespace}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to test release');
    }

    return await response.json();
  }
);

const helmActionsSlice = createSlice({
  name: 'helmActions',
  initialState,
  reducers: {
    clearError: (state) => {
      state.error = null;
    },
    clearLastAction: (state) => {
      state.lastAction = null;
    },
  },
  extraReducers: (builder) => {
    builder
      // Rollback cases
      .addCase(rollbackHelmRelease.pending, (state) => {
        state.rollbackLoading = true;
        state.error = null;
      })
      .addCase(rollbackHelmRelease.fulfilled, (state) => {
        state.rollbackLoading = false;
        state.lastAction = 'rollback';
        state.error = null;
      })
      .addCase(rollbackHelmRelease.rejected, (state, action) => {
        state.rollbackLoading = false;
        state.error = action.error.message || 'Failed to rollback release';
      })
      // Test cases
      .addCase(testHelmRelease.pending, (state) => {
        state.testLoading = true;
        state.error = null;
      })
      .addCase(testHelmRelease.fulfilled, (state) => {
        state.testLoading = false;
        state.lastAction = 'test';
        state.error = null;
      })
      .addCase(testHelmRelease.rejected, (state, action) => {
        state.testLoading = false;
        state.error = action.error.message || 'Failed to test release';
      });
  },
});

export const { clearError, clearLastAction } = helmActionsSlice.actions;
export default helmActionsSlice.reducer;