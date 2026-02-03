package transformers

import (
	"testing"

	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
)

func TestGetContainerStatusReason(t *testing.T) {
	tests := []struct {
		name     string
		pod      *v1.Pod
		expected string
	}{
		{
			name: "CrashLoopBackOff in container",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "CrashLoopBackOff",
								},
							},
						},
					},
				},
			},
			expected: "CrashLoopBackOff",
		},
		{
			name: "ImagePullBackOff in container",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "ImagePullBackOff",
								},
							},
						},
					},
				},
			},
			expected: "ImagePullBackOff",
		},
		{
			name: "OOMKilled in terminated container",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Terminated: &v1.ContainerStateTerminated{
									Reason: "OOMKilled",
								},
							},
						},
					},
				},
			},
			expected: "OOMKilled",
		},
		{
			name: "ContainerCreating waiting state",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "ContainerCreating",
								},
							},
						},
					},
				},
			},
			expected: "ContainerCreating",
		},
		{
			name: "Init container error takes precedence",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					InitContainerStatuses: []v1.ContainerStatus{
						{
							Name: "init",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "ImagePullBackOff",
								},
							},
						},
					},
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "PodInitializing",
								},
							},
						},
					},
				},
			},
			expected: "ImagePullBackOff",
		},
		{
			name: "Error in regular container when init is waiting",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					InitContainerStatuses: []v1.ContainerStatus{
						{
							Name: "init",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "ContainerCreating",
								},
							},
						},
					},
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "CrashLoopBackOff",
								},
							},
						},
					},
				},
			},
			// ContainerCreating is a waiting reason, so we check regular containers
			// CrashLoopBackOff is an error, so it wins
			expected: "CrashLoopBackOff",
		},
		{
			name: "Running container returns empty",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Running: &v1.ContainerStateRunning{},
							},
						},
					},
				},
			},
			expected: "",
		},
		{
			name: "No container statuses returns empty",
			pod: &v1.Pod{
				Status: v1.PodStatus{},
			},
			expected: "",
		},
		{
			name: "Multiple containers - first error wins",
			pod: &v1.Pod{
				Status: v1.PodStatus{
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app1",
							State: v1.ContainerState{
								Running: &v1.ContainerStateRunning{},
							},
						},
						{
							Name: "app2",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "ErrImagePull",
								},
							},
						},
					},
				},
			},
			expected: "ErrImagePull",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := getContainerStatusReason(tt.pod)
			if result != tt.expected {
				t.Errorf("getContainerStatusReason() = %q, expected %q", result, tt.expected)
			}
		})
	}
}

func TestTransformPodToResponse_Status(t *testing.T) {
	tests := []struct {
		name           string
		pod            *v1.Pod
		expectedStatus string
	}{
		{
			name: "Running pod shows Running",
			pod: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-pod",
					UID:  "123",
				},
				Status: v1.PodStatus{
					Phase: v1.PodRunning,
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name:  "app",
							Ready: true,
							State: v1.ContainerState{
								Running: &v1.ContainerStateRunning{},
							},
						},
					},
				},
			},
			expectedStatus: "Running",
		},
		{
			name: "CrashLoopBackOff container shows CrashLoopBackOff",
			pod: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-pod",
					UID:  "123",
				},
				Status: v1.PodStatus{
					Phase: v1.PodRunning,
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "CrashLoopBackOff",
								},
							},
						},
					},
				},
			},
			expectedStatus: "CrashLoopBackOff",
		},
		{
			name: "ImagePullBackOff container shows ImagePullBackOff",
			pod: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-pod",
					UID:  "123",
				},
				Status: v1.PodStatus{
					Phase: v1.PodPending,
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "ImagePullBackOff",
								},
							},
						},
					},
				},
			},
			expectedStatus: "ImagePullBackOff",
		},
		{
			name: "Pod with Reason overrides container status",
			pod: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name: "test-pod",
					UID:  "123",
				},
				Status: v1.PodStatus{
					Phase:  v1.PodFailed,
					Reason: "Evicted",
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Waiting: &v1.ContainerStateWaiting{
									Reason: "CrashLoopBackOff",
								},
							},
						},
					},
				},
			},
			expectedStatus: "Evicted",
		},
		{
			name: "Terminating pod shows Terminating",
			pod: &v1.Pod{
				ObjectMeta: metav1.ObjectMeta{
					Name:              "test-pod",
					UID:               "123",
					DeletionTimestamp: &metav1.Time{},
				},
				Status: v1.PodStatus{
					Phase: v1.PodRunning,
					ContainerStatuses: []v1.ContainerStatus{
						{
							Name: "app",
							State: v1.ContainerState{
								Running: &v1.ContainerStateRunning{},
							},
						},
					},
				},
			},
			expectedStatus: "Terminating",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := TransformPodToResponse(tt.pod, "test-config", "test-cluster")
			if result.Status != tt.expectedStatus {
				t.Errorf("TransformPodToResponse().Status = %q, expected %q", result.Status, tt.expectedStatus)
			}
		})
	}
}
