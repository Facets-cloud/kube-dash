package handlers

import (
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"k8s.io/apimachinery/pkg/api/meta"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/apimachinery/pkg/types"
	utilyaml "k8s.io/apimachinery/pkg/util/yaml"
	"k8s.io/client-go/discovery/cached/memory"
	"k8s.io/client-go/restmapper"
	"k8s.io/utils/ptr"
	"sigs.k8s.io/yaml"
)

// ApplyResources handles applying one or more Kubernetes resources provided as YAML.
// It performs basic validation and uses server-side apply for idempotent creation/update.
// Request: multipart/form-data with field "yaml" containing one or more YAML documents (--- separated)
// Query params: config, cluster
func (h *ResourcesHandler) ApplyResources(c *gin.Context) {
	// Read YAML content from form field
	yamlContent := c.PostForm("yaml")
	if strings.TrimSpace(yamlContent) == "" {
		c.JSON(http.StatusBadRequest, gin.H{"message": "yaml field is required", "code": http.StatusBadRequest})
		return
	}

	// Prepare clients and REST mapper
	dynamicClient, err := h.getDynamicClient(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get dynamic client for apply")
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
		return
	}

	clientset, _, err := h.getClientAndConfig(c)
	if err != nil {
		h.logger.WithError(err).Error("Failed to get clientset for apply")
		c.JSON(http.StatusBadRequest, gin.H{"message": err.Error(), "code": http.StatusBadRequest})
		return
	}

	disco := clientset.Discovery()
	restMapper := restmapper.NewDeferredDiscoveryRESTMapper(memory.NewMemCacheClient(disco))

	// Prepare decoder for multi-document YAML
	decoder := utilyaml.NewYAMLOrJSONDecoder(strings.NewReader(yamlContent), 4096)

	type failure struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace,omitempty"`
		Kind      string `json:"kind,omitempty"`
		Group     string `json:"group,omitempty"`
		Version   string `json:"version,omitempty"`
		Message   string `json:"message"`
	}
	var failures []failure
	var appliedCount int
	type appliedResource struct {
		Name      string `json:"name"`
		Namespace string `json:"namespace,omitempty"`
		Kind      string `json:"kind"`
		Group     string `json:"group"`
		Version   string `json:"version"`
		Resource  string `json:"resource"`
	}
	var appliedResources []appliedResource

	for {
		// Decode each document into a map first to allow empty docs to be skipped
		var raw map[string]interface{}
		if err := decoder.Decode(&raw); err != nil {
			if err == io.EOF {
				break
			}
			failures = append(failures, failure{Message: fmt.Sprintf("failed to decode YAML: %v", err)})
			break
		}

		if len(raw) == 0 {
			// Skip empty documents (e.g., extra --- at end)
			continue
		}

		obj := &unstructured.Unstructured{Object: raw}
		gvk := obj.GroupVersionKind()
		if gvk.Empty() || gvk.Kind == "" || gvk.Version == "" {
			failures = append(failures, failure{
				Name:    obj.GetName(),
				Message: "missing apiVersion or kind in document",
			})
			continue
		}

		mapping, mapErr := restMapper.RESTMapping(schema.GroupKind{Group: gvk.Group, Kind: gvk.Kind}, gvk.Version)
		if mapErr != nil {
			failures = append(failures, failure{
				Name:    obj.GetName(),
				Kind:    gvk.Kind,
				Group:   gvk.Group,
				Version: gvk.Version,
				Message: fmt.Sprintf("failed to resolve GVK to resource: %v", mapErr),
			})
			continue
		}

		// Determine resource interface based on scope
		var ri dynamicResourceInterface
		if mapping.Scope.Name() == meta.RESTScopeNameNamespace {
			ns := obj.GetNamespace()
			if strings.TrimSpace(ns) == "" {
				// Default to "default" namespace when not provided
				ns = "default"
				obj.SetNamespace(ns)
			}
			ri = dynamicResourceInterface{namespaced: true, ns: ns, resource: mapping.Resource}
		} else {
			ri = dynamicResourceInterface{namespaced: false, resource: mapping.Resource}
		}

		// Marshal object back to YAML for server-side apply
		payload, mErr := yaml.Marshal(obj.Object)
		if mErr != nil {
			failures = append(failures, failure{
				Name:    obj.GetName(),
				Kind:    gvk.Kind,
				Group:   gvk.Group,
				Version: gvk.Version,
				Message: fmt.Sprintf("failed to marshal object to YAML: %v", mErr),
			})
			continue
		}

		// Perform server-side apply (idempotent)
		var patchErr error
		if ri.namespaced {
			_, patchErr = dynamicClient.Resource(ri.resource).Namespace(ri.ns).Patch(
				c.Request.Context(),
				obj.GetName(),
				types.ApplyPatchType,
				payload,
				metav1.PatchOptions{FieldManager: "kube-dash", Force: ptr.To(true)},
			)
		} else {
			_, patchErr = dynamicClient.Resource(ri.resource).Patch(
				c.Request.Context(),
				obj.GetName(),
				types.ApplyPatchType,
				payload,
				metav1.PatchOptions{FieldManager: "kube-dash", Force: ptr.To(true)},
			)
		}

		if patchErr != nil {
			failures = append(failures, failure{
				Name:      obj.GetName(),
				Namespace: obj.GetNamespace(),
				Kind:      gvk.Kind,
				Group:     gvk.Group,
				Version:   gvk.Version,
				Message:   patchErr.Error(),
			})
			continue
		}

		appliedCount++
		appliedResources = append(appliedResources, appliedResource{
			Name:      obj.GetName(),
			Namespace: obj.GetNamespace(),
			Kind:      gvk.Kind,
			Group:     gvk.Group,
			Version:   gvk.Version,
			Resource:  mapping.Resource.Resource,
		})
	}

	if len(failures) > 0 {
		c.JSON(http.StatusBadRequest, gin.H{
			"message":          "failed to apply one or more resources",
			"code":             http.StatusBadRequest,
			"details":          failures,
			"applied":          appliedCount,
			"failed":           len(failures),
			"appliedResources": appliedResources,
		})
		return
	}

	// Success: return 200 with applied resources for client navigation
	c.JSON(http.StatusOK, gin.H{
		"message":          "applied",
		"applied":          appliedCount,
		"appliedResources": appliedResources,
	})
}

type dynamicResourceInterface struct {
	namespaced bool
	ns         string
	resource   schema.GroupVersionResource
}
