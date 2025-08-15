package metrics

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/Facets-cloud/kube-dash/internal/api/utils"
	"github.com/Facets-cloud/kube-dash/internal/k8s"
	"github.com/Facets-cloud/kube-dash/internal/storage"
	"github.com/Facets-cloud/kube-dash/pkg/logger"

	"github.com/gin-gonic/gin"
	v1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
)

// PrometheusHandler provides endpoints for Prometheus-backed metrics
type PrometheusHandler struct {
	store         *storage.KubeConfigStore
	clientFactory *k8s.ClientFactory
	logger        *logger.Logger
	sseHandler    *utils.SSEHandler
}

// NewPrometheusHandler creates a new Prometheus metrics handler
func NewPrometheusHandler(store *storage.KubeConfigStore, clientFactory *k8s.ClientFactory, log *logger.Logger) *PrometheusHandler {
	return &PrometheusHandler{
		store:         store,
		clientFactory: clientFactory,
		logger:        log,
		sseHandler:    utils.NewSSEHandler(log),
	}
}

// getClient returns a Kubernetes client for the given config and cluster
func (h *PrometheusHandler) getClient(c *gin.Context) (*kubernetes.Clientset, error) {
	configID := c.Query("config")
	cluster := c.Query("cluster")
	if configID == "" {
		return nil, fmt.Errorf("config parameter is required")
	}
	cfg, err := h.store.GetKubeConfig(configID)
	if err != nil {
		return nil, fmt.Errorf("config not found: %w", err)
	}
	client, err := h.clientFactory.GetClientForConfig(cfg, cluster)
	if err != nil {
		return nil, fmt.Errorf("failed to get Kubernetes client: %w", err)
	}
	return client, nil
}

type promTarget struct {
	Namespace string
	Pod       string
	Port      int
	// Service-based target (optional)
	Service   string
	PortName  string
	IsService bool
}

// discoverPrometheus attempts to find a running Prometheus pod and port in the cluster
func (h *PrometheusHandler) discoverPrometheus(ctx context.Context, client *kubernetes.Clientset) (*promTarget, error) {
	// First, simplified path: look for pods with the canonical label
	labeledPods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/name=prometheus"})
	if err == nil {
		for _, p := range labeledPods.Items {
			// Ensure running
			if p.Status.Phase != v1.PodRunning {
				continue
			}
			// Pick first matching port (9090 or any name containing 'web')
			port := 0
			for _, c := range p.Spec.Containers {
				for _, cp := range c.Ports {
					if cp.ContainerPort == 9090 || strings.Contains(strings.ToLower(cp.Name), "web") {
						port = int(cp.ContainerPort)
						if port == 0 {
							port = 9090
						}
						break
					}
				}
			}
			if port == 0 {
				port = 9090
			}
			// Verify target
			if h.verifyPrometheus(ctx, client, p.Namespace, p.Name, port) == nil {
				return &promTarget{Namespace: p.Namespace, Pod: p.Name, Port: port}, nil
			}
		}
	}

	// Fallbacks: previous heuristics
	// Prefer common namespaces first
	namespaces := []string{"default", "monitoring", "observability", "prometheus"}
	// Helper to check a pod if it looks like Prometheus
	isPromPod := func(pod *v1.Pod) (bool, int) {
		if pod == nil || pod.Status.Phase != v1.PodRunning {
			return false, 0
		}
		for _, c := range pod.Spec.Containers {
			nameLower := strings.ToLower(c.Name)
			imageLower := strings.ToLower(c.Image)
			if (strings.Contains(nameLower, "prometheus") || strings.Contains(imageLower, "prometheus")) &&
				!strings.Contains(nameLower, "operator") && !strings.Contains(imageLower, "operator") {
				// Find port 9090 or named with 'web'
				port := 0
				for _, cp := range c.Ports {
					if cp.ContainerPort == 9090 || strings.Contains(strings.ToLower(cp.Name), "web") {
						port = int(cp.ContainerPort)
						if port == 0 {
							port = 9090
						}
						break
					}
				}
				if port == 0 {
					// Default common Prometheus port
					port = 9090
				}
				return true, port
			}
		}
		return false, 0
	}

	// Try preferred namespaces
	for _, ns := range namespaces {
		pods, err := client.CoreV1().Pods(ns).List(ctx, metav1.ListOptions{})
		if err == nil {
			for _, p := range pods.Items {
				ok, port := isPromPod(&p)
				if ok {
					// Verify
					if h.verifyPrometheus(ctx, client, ns, p.Name, port) == nil {
						return &promTarget{Namespace: ns, Pod: p.Name, Port: port}, nil
					}
				}
			}
		}
	}

	// Fallback: scan all namespaces but stop early
	pods, err := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, fmt.Errorf("failed to list pods for discovery: %w", err)
	}
	for _, p := range pods.Items {
		ok, port := isPromPod(&p)
		if ok {
			if h.verifyPrometheus(ctx, client, p.Namespace, p.Name, port) == nil {
				return &promTarget{Namespace: p.Namespace, Pod: p.Name, Port: port}, nil
			}
		}
	}

	// Try service-based discovery as a fallback
	if svcTarget, err := h.discoverPrometheusViaService(ctx, client); err == nil {
		return svcTarget, nil
	}

	return nil, fmt.Errorf("prometheus not found")
}

// verifyPrometheus calls /api/v1/status/buildinfo via pod proxy to confirm target
func (h *PrometheusHandler) verifyPrometheus(ctx context.Context, client *kubernetes.Clientset, namespace, pod string, port int) error {
	// GET /api/v1/status/buildinfo
	raw, err := client.CoreV1().RESTClient().Get().
		Namespace(namespace).
		Resource("pods").
		Name(pod).
		SubResource("proxy").
		Suffix("api/v1/status/buildinfo").
		Param("port", fmt.Sprintf("%d", port)).
		DoRaw(ctx)
	if err != nil {
		return err
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return err
	}
	if status, ok := resp["status"].(string); !ok || status != "success" {
		return fmt.Errorf("prometheus status not success")
	}
	return nil
}

// proxyPrometheus performs a GET call against the Prometheus HTTP API via pod/service proxy
func (h *PrometheusHandler) proxyPrometheus(ctx context.Context, client *kubernetes.Clientset, target *promTarget, path string, params map[string]string) ([]byte, error) {
	req := client.CoreV1().RESTClient().Get().
		Namespace(target.Namespace)
	// Choose pod or service proxy
	if target.IsService {
		req = req.Resource("services").
			Name(target.Service).
			SubResource("proxy").
			Suffix(strings.TrimPrefix(path, "/"))
		if target.PortName != "" {
			req = req.Param("port", target.PortName)
		} else if target.Port != 0 {
			req = req.Param("port", fmt.Sprintf("%d", target.Port))
		}
	} else {
		req = req.Resource("pods").
			Name(target.Pod).
			SubResource("proxy").
			Suffix(strings.TrimPrefix(path, "/")).
			Param("port", fmt.Sprintf("%d", target.Port))
	}
	for k, v := range params {
		req = req.Param(k, v)
	}
	return req.DoRaw(ctx)
}

// discoverPrometheusViaService finds a Prometheus Service by common names/labels/ports and verifies it
func (h *PrometheusHandler) discoverPrometheusViaService(ctx context.Context, client *kubernetes.Clientset) (*promTarget, error) {
	svcs, err := client.CoreV1().Services("").List(ctx, metav1.ListOptions{})
	if err != nil {
		return nil, err
	}
	type cand struct {
		ns, name, portName string
		port               int
	}
	var candidates []cand
	for _, s := range svcs.Items {
		nameLower := strings.ToLower(s.Name)
		lbl := strings.ToLower(s.Labels["app.kubernetes.io/name"])
		comp := strings.ToLower(s.Labels["app.kubernetes.io/component"])
		if !(strings.Contains(nameLower, "prometheus") || lbl == "prometheus" || comp == "prometheus") {
			continue
		}
		for _, p := range s.Spec.Ports {
			portNameLower := strings.ToLower(p.Name)
			if p.Port == 9090 || strings.Contains(portNameLower, "web") || strings.Contains(portNameLower, "prom") || strings.Contains(portNameLower, "http") {
				candidates = append(candidates, cand{ns: s.Namespace, name: s.Name, portName: p.Name, port: int(p.Port)})
			}
		}
	}
	for _, c := range candidates {
		if err := h.verifyPrometheusService(ctx, client, c.ns, c.name, c.portName, c.port); err == nil {
			return &promTarget{Namespace: c.ns, Service: c.name, PortName: c.portName, Port: c.port, IsService: true}, nil
		}
	}
	return nil, fmt.Errorf("prometheus service not found")
}

// verifyPrometheusService calls buildinfo via the Service proxy
func (h *PrometheusHandler) verifyPrometheusService(ctx context.Context, client *kubernetes.Clientset, namespace, svcName, portName string, port int) error {
	req := client.CoreV1().RESTClient().Get().
		Namespace(namespace).
		Resource("services").
		Name(svcName).
		SubResource("proxy").
		Suffix("api/v1/status/buildinfo")
	if portName != "" {
		req = req.Param("port", portName)
	} else if port != 0 {
		req = req.Param("port", fmt.Sprintf("%d", port))
	}
	raw, err := req.DoRaw(ctx)
	if err != nil {
		return err
	}
	var resp map[string]interface{}
	if err := json.Unmarshal(raw, &resp); err != nil {
		return err
	}
	if status, ok := resp["status"].(string); !ok || status != "success" {
		return fmt.Errorf("prometheus status not success")
	}
	return nil
}

// GetAvailability returns whether Prometheus is installed and reachable
func (h *PrometheusHandler) GetAvailability(c *gin.Context) {
	client, err := h.getClient(c)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"installed": false, "reachable": false, "error": err.Error()})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 3*time.Second)
	defer cancel()

	// Try full discovery (verifies Prometheus is reachable and healthy)
	target, err := h.discoverPrometheus(ctx, client)
	if err == nil && target != nil {
		resp := gin.H{
			"installed": true,
			"reachable": true,
			"namespace": target.Namespace,
			"port":      target.Port,
		}
		if target.IsService {
			resp["service"] = target.Service
			if target.PortName != "" {
				resp["portName"] = target.PortName
			}
		} else {
			resp["pod"] = target.Pod
		}
		c.JSON(http.StatusOK, resp)
		return
	}

	// If discovery failed, perform a lightweight presence check to
	// differentiate "installed but unreachable" from "not installed".
	present := false
	// Look for any pods with canonical prometheus labels
	if pods, errPods := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{LabelSelector: "app.kubernetes.io/name=prometheus"}); errPods == nil && len(pods.Items) > 0 {
		present = true
	}
	// If not found via label, try services with common labels/names
	if !present {
		if svcs, errSvcs := client.CoreV1().Services("").List(ctx, metav1.ListOptions{}); errSvcs == nil {
			for _, s := range svcs.Items {
				nameLower := strings.ToLower(s.Name)
				lbl := strings.ToLower(s.Labels["app.kubernetes.io/name"])
				comp := strings.ToLower(s.Labels["app.kubernetes.io/component"])
				if strings.Contains(nameLower, "prometheus") || lbl == "prometheus" || comp == "prometheus" {
					present = true
					break
				}
			}
		}
	}
	// Fallback: scan pods for containers/images named like prometheus (excluding operator)
	if !present {
		if pods, errPods := client.CoreV1().Pods("").List(ctx, metav1.ListOptions{}); errPods == nil {
			for _, p := range pods.Items {
				for _, ctn := range p.Spec.Containers {
					nameLower := strings.ToLower(ctn.Name)
					imageLower := strings.ToLower(ctn.Image)
					if (strings.Contains(nameLower, "prometheus") || strings.Contains(imageLower, "prometheus")) &&
						!strings.Contains(nameLower, "operator") && !strings.Contains(imageLower, "operator") {
						present = true
						break
					}
				}
				if present {
					break
				}
			}
		}
	}

	if present {
		c.JSON(http.StatusOK, gin.H{"installed": true, "reachable": false, "reason": "prometheus detected but unreachable"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"installed": false, "reachable": false})
}

// ---------- Helpers for Prometheus responses ----------

type promQueryRangeResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string                 `json:"resultType"`
		Result     []promQueryRangeResult `json:"result"`
	} `json:"data"`
}

type promQueryRangeResult struct {
	Metric map[string]string `json:"metric"`
	Values [][]interface{}   `json:"values"` // [ [ <unix>, "value" ], ... ]
}

type timePoint struct {
	T float64 `json:"t"`
	V float64 `json:"v"`
}

type series struct {
	Metric string      `json:"metric"`
	Points []timePoint `json:"points"`
}

// parseMatrix converts Prometheus matrix data into a simplified series list (first series only per metric)
func parseMatrix(raw []byte) ([]series, error) {
	var resp promQueryRangeResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return nil, err
	}
	if resp.Status != "success" {
		return nil, fmt.Errorf("prometheus query failed")
	}
	out := []series{}
	for _, r := range resp.Data.Result {
		// Compose a readable metric label
		label := r.Metric["__name__"]
		if label == "" {
			label = "series"
		}
		pts := make([]timePoint, 0, len(r.Values))
		for _, pair := range r.Values {
			if len(pair) != 2 {
				continue
			}
			// pair[0] = timestamp (float)
			// pair[1] = value (string)
			tsFloat := 0.0
			switch t := pair[0].(type) {
			case float64:
				tsFloat = t
			case json.Number:
				if v, err := t.Float64(); err == nil {
					tsFloat = v
				}
			}
			valStr := fmt.Sprintf("%v", pair[1])
			// Parse as float
			v, err := parseFloat(valStr)
			if err != nil {
				continue
			}
			pts = append(pts, timePoint{T: tsFloat, V: v})
		}
		out = append(out, series{Metric: label, Points: pts})
	}
	return out, nil
}

func parseFloat(s string) (float64, error) {
	if s == "NaN" || s == "+Inf" || s == "-Inf" {
		return 0, nil
	}
	return strconvParseFloat(s)
}

// small wrapper to avoid importing strconv at multiple locations
func strconvParseFloat(s string) (float64, error) { return json.Number(s).Float64() }

// ---------- Pod metrics ----------

// GetPodMetricsSSE streams Prometheus-based pod metrics as SSE
func (h *PrometheusHandler) GetPodMetricsSSE(c *gin.Context) {
	client, err := h.getClient(c)
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}
	namespace := c.Param("namespace")
	name := c.Param("name")
	rng := c.DefaultQuery("range", "15m")
	step := c.DefaultQuery("step", "15s")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	target, err := h.discoverPrometheus(ctx, client)
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusNotFound, "prometheus not available")
		return
	}

	// Build queries
	// CPU mcores
	qCPU := fmt.Sprintf("1000 * sum by (namespace,pod) (rate(container_cpu_usage_seconds_total{namespace=\"%s\",pod=\"%s\",container!~\"POD|istio-proxy|istio-init\"}[5m]))", escapeLabelValue(namespace), escapeLabelValue(name))
	// Memory working set bytes
	qMEM := fmt.Sprintf("sum by (namespace,pod) (container_memory_working_set_bytes{namespace=\"%s\",pod=\"%s\",container!~\"POD|istio-proxy|istio-init\"})", escapeLabelValue(namespace), escapeLabelValue(name))
	// Network RX/TX (best-effort; may be missing)
	qRX := fmt.Sprintf("sum by (namespace,pod) (rate(container_network_receive_bytes_total{namespace=\"%s\",pod=\"%s\"}[5m]))", escapeLabelValue(namespace), escapeLabelValue(name))
	qTX := fmt.Sprintf("sum by (namespace,pod) (rate(container_network_transmit_bytes_total{namespace=\"%s\",pod=\"%s\"}[5m]))", escapeLabelValue(namespace), escapeLabelValue(name))

	fetch := func() (interface{}, error) {
		now := time.Now()
		start := now.Add(-parsePromRange(rng))
		params := map[string]string{
			"query": qCPU,
			"start": fmt.Sprintf("%d", start.Unix()),
			"end":   fmt.Sprintf("%d", now.Unix()),
			"step":  step,
		}
		cpuRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		if err != nil {
			return nil, err
		}
		cpuSeries, _ := parseMatrix(cpuRaw)

		// MEM
		params["query"] = qMEM
		memRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		if err != nil {
			return nil, err
		}
		memSeries, _ := parseMatrix(memRaw)

		// RX
		params["query"] = qRX
		rxRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		rxSeries, _ := parseMatrix(rxRaw)

		// TX
		params["query"] = qTX
		txRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		txSeries, _ := parseMatrix(txRaw)

		payload := gin.H{
			"series": append(append(cpuSeries, memSeries...), append(rxSeries, txSeries...)...),
		}
		return payload, nil
	}

	initial, err := fetch()
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.sseHandler.SendSSEResponseWithUpdates(c, initial, fetch)
}

// ---------- Node metrics ----------

// GetNodeMetricsSSE streams Prometheus-based node metrics as SSE
func (h *PrometheusHandler) GetNodeMetricsSSE(c *gin.Context) {
	client, err := h.getClient(c)
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}
	nodeName := c.Param("name")
	rng := c.DefaultQuery("range", "15m")
	step := c.DefaultQuery("step", "15s")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	target, err := h.discoverPrometheus(ctx, client)
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusNotFound, "prometheus not available")
		return
	}

	// Node selector via node_uname_info nodename filter
	nodeSel := fmt.Sprintf("on(instance) group_left(nodename) node_uname_info{nodename=\"%s\"}", escapeLabelValue(nodeName))

	// CPU utilization %
	qCPU := fmt.Sprintf("100 * (sum by (instance) (rate(node_cpu_seconds_total{mode!=\"idle\",mode!=\"iowait\",mode!=\"steal\"}[5m])) / sum by (instance) (rate(node_cpu_seconds_total[5m]))) * %s", nodeSel)
	// Memory utilization %
	qMEM := fmt.Sprintf("100 * (1 - (node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)) * %s", nodeSel)
	// Filesystem usage % (root mount best-effort)
	qFS := fmt.Sprintf("100 * (1 - (node_filesystem_avail_bytes{fstype!~\"tmpfs|overlay\",mountpoint=\"/\"} / node_filesystem_size_bytes{fstype!~\"tmpfs|overlay\",mountpoint=\"/\"})) * %s", nodeSel)
	// Network RX/TX
	qRX := fmt.Sprintf("sum by (instance) (rate(node_network_receive_bytes_total{name!~\"lo\"}[5m])) * %s", nodeSel)
	qTX := fmt.Sprintf("sum by (instance) (rate(node_network_transmit_bytes_total{name!~\"lo\"}[5m])) * %s", nodeSel)

	// Instant: pods used/capacity
	qPodsCap := fmt.Sprintf("max by (node) (kube_node_status_capacity{resource=\"pods\",node=\"%s\"})", escapeLabelValue(nodeName))
	qPodsUsed := fmt.Sprintf("max by (node) (kubelet_running_pod_count{node=\"%s\"})", escapeLabelValue(nodeName))

	fetch := func() (interface{}, error) {
		now := time.Now()
		start := now.Add(-parsePromRange(rng))
		params := map[string]string{
			"start": fmt.Sprintf("%d", start.Unix()),
			"end":   fmt.Sprintf("%d", now.Unix()),
			"step":  step,
		}

		// CPU
		params["query"] = url.QueryEscape(qCPU)
		cpuRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		if err != nil {
			return nil, err
		}
		cpuSeries, _ := parseMatrix(cpuRaw)

		// MEM
		params["query"] = url.QueryEscape(qMEM)
		memRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		if err != nil {
			return nil, err
		}
		memSeries, _ := parseMatrix(memRaw)

		// FS
		params["query"] = url.QueryEscape(qFS)
		fsRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		fsSeries, _ := parseMatrix(fsRaw)

		// RX
		params["query"] = url.QueryEscape(qRX)
		rxRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		rxSeries, _ := parseMatrix(rxRaw)

		// TX
		params["query"] = url.QueryEscape(qTX)
		txRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		txSeries, _ := parseMatrix(txRaw)

		// Instant pods used/capacity
		pods := gin.H{"used": nil, "capacity": nil}
		capRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qPodsCap})
		if err == nil {
			pods["capacity"] = capRaw
		}
		usedRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qPodsUsed})
		if err == nil {
			pods["used"] = usedRaw
		}

		payload := gin.H{
			"series":  append(append(append(cpuSeries, memSeries...), append(fsSeries, rxSeries...)...), txSeries...),
			"instant": pods,
		}
		return payload, nil
	}

	initial, err := fetch()
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.sseHandler.SendSSEResponseWithUpdates(c, initial, fetch)
}

// ---------- Cluster overview ----------

type promQueryResponse struct {
	Status string `json:"status"`
	Data   struct {
		ResultType string `json:"resultType"`
		Result     []struct {
			Metric map[string]string `json:"metric"`
			Value  []interface{}     `json:"value"`
		} `json:"result"`
	} `json:"data"`
}

func parseVectorSum(raw []byte) (float64, error) {
	var resp promQueryResponse
	if err := json.Unmarshal(raw, &resp); err != nil {
		return 0, err
	}
	if resp.Status != "success" {
		return 0, fmt.Errorf("prometheus query failed")
	}
	sum := 0.0
	for _, r := range resp.Data.Result {
		if len(r.Value) != 2 {
			continue
		}
		valStr := fmt.Sprintf("%v", r.Value[1])
		v, err := parseFloat(valStr)
		if err != nil {
			continue
		}
		sum += v
	}
	return sum, nil
}

// GetClusterOverviewSSE streams cluster-wide stats including node count, CPU packing, and memory packing
func (h *PrometheusHandler) GetClusterOverviewSSE(c *gin.Context) {
	client, err := h.getClient(c)
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusBadRequest, err.Error())
		return
	}
	rng := c.DefaultQuery("range", "15m")
	step := c.DefaultQuery("step", "15s")
	configID := c.Query("config")
	cluster := c.Query("cluster")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 4*time.Second)
	defer cancel()
	target, err := h.discoverPrometheus(ctx, client)
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusNotFound, "prometheus not available")
		return
	}

	// New cluster stats queries
	// Node count: rely on kube-state-metrics condition for Ready nodes
	qNodeCount := "sum(kube_node_status_condition{condition=\"Ready\",status=\"true\"} == 1)"
	qCPUPacking := "sum(kube_pod_container_resource_requests{resource=\"cpu\", service=\"prometheus-operator-kube-state-metrics\"} * on (pod,instance,uid) group_left () kube_pod_status_phase{service=\"prometheus-operator-kube-state-metrics\", phase=\"Running\"})/sum(kube_node_status_allocatable{resource=\"cpu\",endpoint=\"http\"})*100"
	qMemoryPacking := "sum(kube_pod_container_resource_requests{resource=\"memory\", service=\"prometheus-operator-kube-state-metrics\"} * on (pod,instance,uid) group_left () kube_pod_status_phase{service=\"prometheus-operator-kube-state-metrics\", phase=\"Running\"})/sum(kube_node_status_allocatable{resource=\"memory\",endpoint=\"http\"})*100"

	// CPU allocation summary queries
	qTotalAllocatableCPU := "sum(kube_node_status_allocatable{resource=\"cpu\"})"
	qTotalCPURequests := "sum(kube_pod_container_resource_requests{resource=\"cpu\"})"

	// Memory allocation summary queries
	qTotalAllocatableMemory := "sum(kube_node_status_allocatable{resource=\"memory\"})"
	qTotalMemoryRequests := "sum(kube_pod_container_resource_requests{resource=\"memory\"})"

	fetch := func() (interface{}, error) {
		now := time.Now()
		start := now.Add(-parsePromRange(rng))
		params := map[string]string{
			"start": fmt.Sprintf("%d", start.Unix()),
			"end":   fmt.Sprintf("%d", now.Unix()),
			"step":  step,
		}

		// Node count series
		params["query"] = qNodeCount
		nodeCountRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		if err != nil {
			return nil, err
		}
		nodeCountSeries, _ := parseMatrix(nodeCountRaw)
		for i := range nodeCountSeries {
			nodeCountSeries[i].Metric = "node_count"
		}

		// CPU packing series
		params["query"] = qCPUPacking
		cpuPackingRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		if err != nil {
			return nil, err
		}
		cpuPackingSeries, _ := parseMatrix(cpuPackingRaw)

		// Memory packing series
		params["query"] = qMemoryPacking
		memoryPackingRaw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query_range", params)
		if err != nil {
			return nil, err
		}
		memoryPackingSeries, _ := parseMatrix(memoryPackingRaw)

		// Instant values for current metrics
		nodeCountInstantRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qNodeCount})
		nodeCountInstant, _ := parseVectorSum(nodeCountInstantRaw)
		cpuPackingInstantRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qCPUPacking})
		cpuPackingInstant, _ := parseVectorSum(cpuPackingInstantRaw)
		memoryPackingInstantRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qMemoryPacking})
		memoryPackingInstant, _ := parseVectorSum(memoryPackingInstantRaw)

		// CPU allocation summary metrics
		totalAllocatableCPURaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qTotalAllocatableCPU})
		totalAllocatableCPU, _ := parseVectorSum(totalAllocatableCPURaw)
		totalCPURequestsRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qTotalCPURequests})
		totalCPURequests, _ := parseVectorSum(totalCPURequestsRaw)

		// Memory allocation summary metrics
		totalAllocatableMemoryRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qTotalAllocatableMemory})
		totalAllocatableMemory, _ := parseVectorSum(totalAllocatableMemoryRaw)
		totalMemoryRequestsRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qTotalMemoryRequests})
		totalMemoryRequests, _ := parseVectorSum(totalMemoryRequestsRaw)

		// Pods capacity (max accommodated) and present (any phase)
		qPodsCapacityWithUnit := `sum(kube_node_status_capacity{resource="pods",unit="integer"})`
		qPodsCapacity := `sum(kube_node_status_capacity{resource="pods"})`
		qPodsCapacityLegacy := `sum(kube_node_status_capacity_pods)`
		qPodsPresent := `sum(max by (namespace,pod) (kube_pod_status_phase == 1))`

		podsCapacity := 0.0
		if raw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qPodsCapacityWithUnit}); err == nil {
			podsCapacity, _ = parseVectorSum(raw)
		}
		if podsCapacity == 0 {
			if raw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qPodsCapacity}); err == nil {
				podsCapacity, _ = parseVectorSum(raw)
			}
		}
		if podsCapacity == 0 {
			if raw, err := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qPodsCapacityLegacy}); err == nil {
				podsCapacity, _ = parseVectorSum(raw)
			}
		}

		podsPresentRaw, _ := h.proxyPrometheus(c.Request.Context(), client, target, "/api/v1/query", map[string]string{"query": qPodsPresent})
		podsPresent, _ := parseVectorSum(podsPresentRaw)

		// Kubernetes server version (best-effort)
		k8sVersion := ""
		if info, err := client.Discovery().ServerVersion(); err == nil && info != nil {
			if info.GitVersion != "" {
				k8sVersion = info.GitVersion
			} else if info.String() != "" {
				k8sVersion = info.String()
			}
		}

		// Metrics server availability (best-effort, short timeout)
		metricsServer := false
		if configID != "" {
			if cfg, err := h.store.GetKubeConfig(configID); err == nil {
				if mClient, err := h.clientFactory.GetMetricsClientForConfig(cfg, cluster); err == nil && mClient != nil {
					ctx2, cancel2 := context.WithTimeout(c.Request.Context(), 800*time.Millisecond)
					defer cancel2()
					if _, err := mClient.MetricsV1beta1().NodeMetricses().List(ctx2, metav1.ListOptions{Limit: 1}); err == nil {
						metricsServer = true
					}
				}
			}
		}

		payload := gin.H{
			"series": append(append(nodeCountSeries, cpuPackingSeries...), memoryPackingSeries...),
			"instant": gin.H{
				"node_count":               nodeCountInstant,
				"cpu_packing":              cpuPackingInstant,
				"memory_packing":           memoryPackingInstant,
				"total_allocatable_cpu":    totalAllocatableCPU,
				"total_cpu_requests":       totalCPURequests,
				"total_allocatable_memory": totalAllocatableMemory,
				"total_memory_requests":    totalMemoryRequests,
				"pods_capacity":            podsCapacity,
				"pods_present":             podsPresent,
				"kubernetes_version":       k8sVersion,
				"metrics_server":           metricsServer,
			},
		}
		return payload, nil
	}

	initial, err := fetch()
	if err != nil {
		h.sseHandler.SendSSEError(c, http.StatusInternalServerError, err.Error())
		return
	}
	h.sseHandler.SendSSEResponseWithUpdates(c, initial, fetch)
}

// ---------- utilities ----------

func escapeLabelValue(s string) string {
	// Escape quotes/backslashes for Prometheus label values
	s = strings.ReplaceAll(s, "\\", "\\\\")
	s = strings.ReplaceAll(s, "\"", "\\\"")
	return s
}

func parsePromRange(r string) time.Duration {
	// Very small parser for inputs like 15m, 1h, 6h
	if r == "" {
		return 15 * time.Minute
	}
	if strings.HasSuffix(r, "m") {
		n := strings.TrimSuffix(r, "m")
		if d, err := time.ParseDuration(n + "m"); err == nil {
			return d
		}
	}
	if strings.HasSuffix(r, "h") {
		n := strings.TrimSuffix(r, "h")
		if d, err := time.ParseDuration(n + "h"); err == nil {
			return d
		}
	}
	// Support days, e.g., 1d, 7d, 15d, 30d
	if strings.HasSuffix(r, "d") {
		n := strings.TrimSuffix(r, "d")
		if days, err := strconv.Atoi(n); err == nil {
			return time.Duration(days) * 24 * time.Hour
		}
	}
	// fallback
	return 15 * time.Minute
}
