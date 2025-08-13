package helm

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// HelmChart represents a Helm chart from Artifact Hub
type HelmChart struct {
	ID          string                `json:"id"`
	Name        string                `json:"name"`
	Description string                `json:"description"`
	Home        string                `json:"home"`
	Keywords    []string              `json:"keywords"`
	Maintainers []HelmChartMaintainer `json:"maintainers"`
	Sources     []string              `json:"sources"`
	Icon        string                `json:"icon"`
	AppVersion  string                `json:"appVersion"`
	Version     string                `json:"version"`
	Created     string                `json:"created"`
	Digest      string                `json:"digest"`
	Urls        []string              `json:"urls"`
	Repository  HelmChartRepository   `json:"repository"`
}

// HelmChartMaintainer represents a chart maintainer
type HelmChartMaintainer struct {
	Name  string `json:"name"`
	Email string `json:"email,omitempty"`
	URL   string `json:"url,omitempty"`
}

// HelmChartRepository represents a chart repository
type HelmChartRepository struct {
	Name     string `json:"name"`
	URL      string `json:"url"`
	Official bool   `json:"official,omitempty"`
}

// HelmChartVersion represents a specific version of a chart
type HelmChartVersion struct {
	Version     string   `json:"version"`
	AppVersion  string   `json:"appVersion"`
	Created     string   `json:"created"`
	Description string   `json:"description"`
	Digest      string   `json:"digest"`
	Urls        []string `json:"urls"`
}

// HelmChartsSearchResponse represents the response from chart search
type HelmChartsSearchResponse struct {
	Data  []HelmChart `json:"data"`
	Total int         `json:"total"`
	Page  int         `json:"page"`
	Size  int         `json:"size"`
}

// ArtifactHubResponse represents the response from Artifact Hub API
type ArtifactHubResponse struct {
	Packages []struct {
		PackageID   string `json:"package_id"`
		Name        string `json:"name"`
		DisplayName string `json:"display_name"`
		Description string `json:"description"`
		LogoImageID string `json:"logo_image_id"`
		AppVersion  string `json:"app_version"`
		Version     string `json:"version"`
		Repository  struct {
			Name         string `json:"name"`
			DisplayName  string `json:"display_name"`
			URL          string `json:"url"`
			Official     bool   `json:"official"`
			UserAlias    string `json:"user_alias"`
			Organization struct {
				Name        string `json:"name"`
				DisplayName string `json:"display_name"`
			} `json:"organization"`
		} `json:"repository"`
		Stats struct {
			Subscriptions int `json:"subscriptions"`
			Webhooks      int `json:"webhooks"`
		} `json:"stats"`
		CreatedAt int64 `json:"ts"`
	} `json:"packages"`
}

// resolveRepoPathFromPackageOrName attempts to resolve a usable Artifact Hub
// repository path (helm/<repo>/<chart>) from a provided identifier.
// The identifier may be:
// - a known package ID previously cached via search
// - a full repo path already (e.g., helm/bitnami/kafka)
// - a plain chart name (e.g., kafka) – in this case we search Artifact Hub
// Optionally respects a `repository` query parameter to narrow matches.
func (h *HelmHandler) resolveRepoPathFromPackageOrName(c *gin.Context, packageOrName string) (string, bool) {
	// Quick cache: chart name -> repo path
	h.chartNameMux.RLock()
	if rp, ok := h.chartNameRepoPath[packageOrName]; ok && rp != "" {
		h.chartNameMux.RUnlock()
		return rp, true
	}
	h.chartNameMux.RUnlock()
	// 1) Check mapping cache first (populated during search calls)
	if repoPath, ok := h.packageIDToRepoPath(packageOrName); ok {
		return repoPath, true
	}

	// 2) If it looks like a repo path already, accept as-is
	if strings.Count(packageOrName, "/") >= 2 {
		return packageOrName, true
	}

	// 3) Fallback: search Artifact Hub by chart name
	chartName := strings.TrimSpace(packageOrName)
	if chartName == "" {
		return "", false
	}

	repoFilter := strings.TrimSpace(c.Query("repository"))

	searchURL := fmt.Sprintf(
		"https://artifacthub.io/api/v1/packages/search?kind=0&ts_query_web=%s&limit=%d",
		url.QueryEscape(chartName), 25,
	)

	client := &http.Client{Timeout: 30 * time.Second}
	req, _ := http.NewRequest("GET", searchURL, nil)
	req.Header.Set("User-Agent", "kube-dash/1.0")
	resp, err := client.Do(req)
	if err != nil {
		h.logger.Warn("Artifact Hub search failed", "error", err, "chart", chartName)
		return "", false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		h.logger.Warn("Artifact Hub search returned non-200", "status", resp.StatusCode, "chart", chartName)
		return "", false
	}

	var search ArtifactHubResponse
	if err := json.NewDecoder(resp.Body).Decode(&search); err != nil {
		h.logger.Warn("Failed to decode Artifact Hub search response", "error", err)
		return "", false
	}

	// Choose best match:
	// - Prefer exact name match
	// - If repository filter is provided, prefer that repository
	// - Otherwise, just take the first result
	type candidate struct {
		repo string
		name string
		pkg  string
	}
	var chosen *candidate
	for _, p := range search.Packages {
		if strings.EqualFold(p.Name, chartName) {
			if repoFilter == "" || strings.EqualFold(p.Repository.Name, repoFilter) || strings.EqualFold(p.Repository.DisplayName, repoFilter) || strings.EqualFold(p.Repository.Organization.Name, repoFilter) {
				cnd := &candidate{repo: p.Repository.Name, name: p.Name, pkg: p.PackageID}
				chosen = cnd
				break
			}
		}
		if chosen == nil {
			// fallback candidate if no exact+repo match found yet
			chosen = &candidate{repo: p.Repository.Name, name: p.Name, pkg: p.PackageID}
		}
	}

	if chosen == nil || chosen.repo == "" || chosen.name == "" {
		h.logger.Warn("No suitable chart found on Artifact Hub search", "chart", chartName, "repository", repoFilter)
		return "", false
	}

	repoPath := fmt.Sprintf("helm/%s/%s", chosen.repo, chosen.name)
	// Cache mapping for subsequent calls (helps templates, details, etc.)
	h.setPackageRepoPath(chosen.pkg, chosen.repo, chosen.name)
	// Save name cache
	h.chartNameMux.Lock()
	h.chartNameRepoPath[packageOrName] = repoPath
	h.chartNameMux.Unlock()
	return repoPath, true
}

// SearchHelmCharts searches for Helm charts using Artifact Hub API
func (h *HelmHandler) SearchHelmCharts(c *gin.Context) {
	query := c.Query("q")
	page := c.DefaultQuery("page", "1")
	size := c.DefaultQuery("size", "20")
	category := c.Query("category")
	repository := c.Query("repository")

	// Convert page and size to integers
	pageInt, err := strconv.Atoi(page)
	if err != nil {
		pageInt = 1
	}
	sizeInt, err := strconv.Atoi(size)
	if err != nil {
		sizeInt = 20
	}

	// Build Artifact Hub API URL
	apiURL := "https://artifacthub.io/api/v1/packages/search"
	params := []string{
		fmt.Sprintf("kind=0"), // 0 = Helm charts
		fmt.Sprintf("offset=%d", (pageInt-1)*sizeInt),
		fmt.Sprintf("limit=%d", sizeInt),
	}

	if query != "" {
		params = append(params, fmt.Sprintf("ts_query_web=%s", query))
	}
	if category != "" {
		params = append(params, fmt.Sprintf("category=%s", category))
	}
	if repository != "" {
		params = append(params, fmt.Sprintf("repo=%s", repository))
	}

	fullURL := fmt.Sprintf("%s?%s", apiURL, strings.Join(params, "&"))

	// Log the request for debugging
	h.logger.Info("Making request to Artifact Hub", "url", fullURL)

	// Make HTTP request to Artifact Hub
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", fullURL, nil)
	if err != nil {
		h.logger.Error("Failed to create request", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create request"})
		return
	}
	req.Header.Set("User-Agent", "kube-dash/1.0")
	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("Failed to fetch charts from Artifact Hub", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch charts"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		h.logger.Error("Artifact Hub API returned non-200 status", "status", resp.StatusCode, "headers", resp.Header)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch charts from Artifact Hub"})
		return
	}

	// Log response headers for debugging
	h.logger.Info("Artifact Hub response headers", "content-length", resp.Header.Get("Content-Length"), "content-type", resp.Header.Get("Content-Type"))

	// Read response body for debugging
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		h.logger.Error("Failed to read response body", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read response"})
		return
	}
	h.logger.Info("Raw response body", "body", string(body)[:min(len(body), 500)]) // Log first 500 chars

	// Parse response
	var artifactResponse ArtifactHubResponse
	if err := json.Unmarshal(body, &artifactResponse); err != nil {
		h.logger.Error("Failed to decode Artifact Hub response", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse charts data"})
		return
	}

	// Log response details for debugging
	h.logger.Info("Artifact Hub response", "data_count", len(artifactResponse.Packages))

	// Convert to our format
	charts := make([]HelmChart, len(artifactResponse.Packages))
	for i, item := range artifactResponse.Packages {
		charts[i] = HelmChart{
			ID:          item.PackageID,
			Name:        item.Name,
			Description: item.Description,
			AppVersion:  item.AppVersion,
			Version:     item.Version,
			Created:     time.Unix(item.CreatedAt, 0).Format(time.RFC3339),
			Repository: HelmChartRepository{
				Name:     item.Repository.Name,
				URL:      item.Repository.URL,
				Official: item.Repository.Official,
			},
		}
		if item.LogoImageID != "" {
			charts[i].Icon = fmt.Sprintf("https://artifacthub.io/image/%s", item.LogoImageID)
		}

		// Cache mapping of package ID to repo path for subsequent endpoints
		// repo path format expected by Artifact Hub: helm/<repo>/<chart>
		h.setPackageRepoPath(item.PackageID, item.Repository.Name, item.Name)
	}

	// Since Artifact Hub API doesn't provide total count, use the number of results returned
	totalCount := len(artifactResponse.Packages)

	response := HelmChartsSearchResponse{
		Data:  charts,
		Total: totalCount,
		Page:  pageInt,
		Size:  sizeInt,
	}

	c.JSON(http.StatusOK, response)
}

// fetchDefaultValuesFromArtifactHub fetches default values using Artifact Hub API
// fetchDefaultValuesFromArtifactHub attempts to obtain default values.yaml for a chart
// Strategy:
// 1) Use the package details' content_url to download the .tgz and extract values.yaml
// 2) Fallback to empty string if anything fails
func (h *HelmHandler) fetchDefaultValuesFromArtifactHub(contentURL string) (string, error) {
	if strings.TrimSpace(contentURL) == "" {
		return "", fmt.Errorf("content_url not available")
	}
	client := &http.Client{Timeout: 45 * time.Second}
	resp, err := client.Get(contentURL)
	if err != nil {
		return "", fmt.Errorf("failed to download chart archive: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("failed to download chart archive: status %d", resp.StatusCode)
	}

	// Read archive into memory (bounded)
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read chart archive: %w", err)
	}

	// Un-gzip
	gzReader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to open gzip reader: %w", err)
	}
	defer gzReader.Close()

	// Untar and look for values.yaml
	tarReader := tar.NewReader(gzReader)
	for {
		hdr, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return "", fmt.Errorf("failed to read tar: %w", err)
		}
		if hdr == nil {
			continue
		}
		name := strings.ToLower(hdr.Name)
		if strings.HasSuffix(name, "/values.yaml") || name == "values.yaml" {
			contents, err := io.ReadAll(tarReader)
			if err != nil {
				return "", fmt.Errorf("failed to read values.yaml: %w", err)
			}
			return string(contents), nil
		}
	}
	return "", fmt.Errorf("values.yaml not found in chart archive")
}

// GetHelmChartDetails gets detailed information about a specific chart
func (h *HelmHandler) GetHelmChartDetails(c *gin.Context) {
	packageID := c.Param("packageId")
	if packageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Package ID is required"})
		return
	}

	// Try to get repository path from package ID (populated during search)
	repoPath, ok := h.packageIDToRepoPath(packageID)
	if !ok {
		h.logger.Warn("Package ID mapping not found for details", "packageId", packageID)
		c.JSON(http.StatusOK, map[string]interface{}{
			"package_id":     packageID,
			"default_values": "",
			"error":          "Package mapping not available",
		})
		return
	}

	h.logger.Info("Fetching chart details from Artifact Hub", "packageId", packageID, "repoPath", repoPath)
	// We'll populate values via content_url extraction

	// Fetch package details using the repo path
	apiURL := fmt.Sprintf("https://artifacthub.io/api/v1/packages/%s", repoPath)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		h.logger.Error("Failed to fetch chart details from Artifact Hub", "error", err)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch chart details"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		h.logger.Error("Artifact Hub API returned non-200 status for package details", "status", resp.StatusCode, "packageId", packageID)
		basicResponse := map[string]interface{}{
			"package_id":     packageID,
			"default_values": "",
			"error":          "Package details not available",
		}
		c.JSON(http.StatusOK, basicResponse)
		return
	}

	// Parse the response
	var packageDetails map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&packageDetails); err != nil {
		h.logger.Error("Failed to decode chart details response", "error", err)
		basicResponse := map[string]interface{}{
			"package_id":     packageID,
			"default_values": "",
			"error":          "Failed to parse package details",
		}
		c.JSON(http.StatusOK, basicResponse)
		return
	}

	// Try to fetch default values using content_url
	if cu, ok := packageDetails["content_url"].(string); ok && cu != "" {
		if values, err := h.fetchDefaultValuesFromArtifactHub(cu); err == nil {
			packageDetails["default_values"] = values
		} else {
			h.logger.Warn("Failed to fetch values from content_url", "error", err)
			packageDetails["default_values"] = ""
		}
	}

	c.JSON(http.StatusOK, packageDetails)
}

// packageIDToRepoPath maps package IDs to their repository paths (delegates to handler cache)
// Kept for compatibility where this file referenced it previously
// The actual storage is in HelmHandler.pkgIDRepoPath populated during search
// Removed: now defined on handler in helm.go to avoid recursion

// GetHelmChartVersions gets all versions of a specific chart
func (h *HelmHandler) GetHelmChartVersions(c *gin.Context) {
	packageID := c.Param("packageId")
	if packageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Package ID is required"})
		return
	}

	// Try to resolve repository path from provided identifier
	repoPath, ok := h.resolveRepoPathFromPackageOrName(c, packageID)
	if !ok {
		h.logger.Warn("Unable to resolve repo path for versions", "identifier", packageID)
		c.JSON(http.StatusOK, []map[string]interface{}{})
		return
	}

	// Make HTTP request to Artifact Hub for package details using repo path
	apiURL := fmt.Sprintf("https://artifacthub.io/api/v1/packages/%s", repoPath)
	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Get(apiURL)
	if err != nil {
		h.logger.Error("Failed to fetch chart details from Artifact Hub", "error", err, "packageId", packageID, "repoPath", repoPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch chart versions"})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		h.logger.Error("Artifact Hub API returned non-200 status for package details", "status", resp.StatusCode, "packageId", packageID, "repoPath", repoPath)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to fetch chart versions from Artifact Hub"})
		return
	}

	// Parse the package response and extract available_versions
	var packageDetails map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&packageDetails); err != nil {
		h.logger.Error("Failed to decode chart package response", "error", err, "packageId", packageID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse chart versions"})
		return
	}

	// Extract available_versions from the package details
	availableVersions, exists := packageDetails["available_versions"]
	if !exists {
		h.logger.Warn("No available_versions found in package details", "packageId", packageID)
		c.JSON(http.StatusOK, []map[string]interface{}{})
		return
	}

	// Convert to expected format (camelCase keys and created timestamp)
	rawVersions, ok := availableVersions.([]interface{})
	if !ok {
		h.logger.Error("available_versions is not an array", "packageId", packageID)
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to parse chart versions"})
		return
	}

	result := make([]map[string]interface{}, 0, len(rawVersions))
	for _, rv := range rawVersions {
		if m, ok := rv.(map[string]interface{}); ok {
			item := map[string]interface{}{}
			if v, ok := m["version"].(string); ok {
				item["version"] = v
			}
			if av, ok := m["app_version"].(string); ok {
				item["appVersion"] = av
			}
			if ts, ok := m["ts"].(float64); ok {
				item["created"] = time.Unix(int64(ts), 0).Format(time.RFC3339)
			}
			if pre, ok := m["prerelease"].(bool); ok {
				item["prerelease"] = pre
			}
			result = append(result, item)
		}
	}

	c.JSON(http.StatusOK, result)
}

// GetHelmChartTemplates fetches templates for a specific chart version from Artifact Hub
func (h *HelmHandler) GetHelmChartTemplates(c *gin.Context) {
	packageID := c.Param("packageId")
	version := c.Param("version")
	if packageID == "" || version == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Package ID and version are required"})
		return
	}

	// Resolve repository path if needed
	repoPath, ok := h.resolveRepoPathFromPackageOrName(c, packageID)
	if !ok {
		// Degrade gracefully: return empty list rather than hard error so the UI stays usable
		h.logger.Warn("Unable to resolve repo path for templates", "identifier", packageID)
		c.JSON(http.StatusOK, []map[string]string{})
		return
	}

	// Fetch package version details to obtain content_url
	detailsURL := fmt.Sprintf("https://artifacthub.io/api/v1/packages/%s/%s", repoPath, version)
	client := &http.Client{Timeout: 30 * time.Second}
	req, err := http.NewRequest("GET", detailsURL, nil)
	if err != nil {
		h.logger.Error("Failed to create request for package version details", "error", err)
		c.JSON(http.StatusOK, []map[string]string{})
		return
	}
	req.Header.Set("User-Agent", "kube-dash/1.0")

	resp, err := client.Do(req)
	if err != nil {
		h.logger.Error("Failed to fetch package version details from Artifact Hub", "error", err)
		c.JSON(http.StatusOK, []map[string]string{})
		return
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		h.logger.Error("Artifact Hub API returned non-200 for package version details", "status", resp.StatusCode, "repoPath", repoPath, "version", version)
		c.JSON(http.StatusOK, []map[string]string{})
		return
	}

	var versionDetails map[string]interface{}
	if err := json.NewDecoder(resp.Body).Decode(&versionDetails); err != nil {
		h.logger.Error("Failed to decode version details", "error", err)
		c.JSON(http.StatusOK, []map[string]string{})
		return
	}

	cu, _ := versionDetails["content_url"].(string)
	if strings.TrimSpace(cu) == "" {
		h.logger.Warn("content_url not available in version details", "repoPath", repoPath, "version", version)
		c.JSON(http.StatusOK, []map[string]string{})
		return
	}

	templates, err := h.fetchTemplatesFromArtifactHub(cu)
	if err != nil {
		h.logger.Warn("Failed to extract templates from chart archive", "error", err)
		c.JSON(http.StatusOK, []map[string]string{})
		return
	}

	c.JSON(http.StatusOK, templates)
}

// fetchTemplatesFromArtifactHub downloads the chart archive from contentURL and extracts files under templates/
func (h *HelmHandler) fetchTemplatesFromArtifactHub(contentURL string) ([]map[string]string, error) {
	if strings.TrimSpace(contentURL) == "" {
		return nil, fmt.Errorf("content_url not available")
	}
	client := &http.Client{Timeout: 60 * time.Second}
	resp, err := client.Get(contentURL)
	if err != nil {
		return nil, fmt.Errorf("failed to download chart archive: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("failed to download chart archive: status %d", resp.StatusCode)
	}

	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read chart archive: %w", err)
	}

	gzReader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("failed to open gzip reader: %w", err)
	}
	defer gzReader.Close()

	tarReader := tar.NewReader(gzReader)
	templates := []map[string]string{}
	for {
		hdr, err := tarReader.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, fmt.Errorf("failed to read tar: %w", err)
		}
		if hdr == nil || hdr.FileInfo().IsDir() {
			continue
		}
		nameLower := strings.ToLower(hdr.Name)
		if strings.Contains(nameLower, "/templates/") {
			contents, err := io.ReadAll(tarReader)
			if err != nil {
				return nil, fmt.Errorf("failed to read template %s: %w", hdr.Name, err)
			}
			// Use path after the templates/ segment for display
			displayName := hdr.Name
			if idx := strings.Index(strings.ToLower(hdr.Name), "/templates/"); idx >= 0 {
				displayName = hdr.Name[idx+len("/templates/"):]
			}
			templates = append(templates, map[string]string{
				"name":    displayName,
				"content": string(contents),
			})
		}
	}
	return templates, nil
}
