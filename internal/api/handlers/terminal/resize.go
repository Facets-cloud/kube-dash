package terminal

import (
	"sync"
	"time"
)

// ResizeManager handles terminal resize operations with debouncing
// to prevent excessive resize messages to K8s
type ResizeManager struct {
	executor      *K8sExecutor
	currentCols   uint16
	currentRows   uint16
	pendingResize *ResizeDimensions
	mutex         sync.Mutex
	debounceTimer *time.Timer
	debounceDelay time.Duration
}

// NewResizeManager creates a new resize manager
func NewResizeManager(executor *K8sExecutor) *ResizeManager {
	return &ResizeManager{
		executor:      executor,
		debounceDelay: 50 * time.Millisecond, // Debounce resize events
	}
}

// RequestResize queues a resize request with debouncing
func (rm *ResizeManager) RequestResize(cols, rows uint16) {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	// Skip if dimensions haven't changed
	if cols == rm.currentCols && rows == rm.currentRows {
		return
	}

	// Store pending resize
	rm.pendingResize = &ResizeDimensions{Cols: cols, Rows: rows}

	// Cancel existing timer
	if rm.debounceTimer != nil {
		rm.debounceTimer.Stop()
	}

	// Start new debounce timer
	rm.debounceTimer = time.AfterFunc(rm.debounceDelay, rm.flushResize)
}

// flushResize sends the pending resize to K8s
func (rm *ResizeManager) flushResize() {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	if rm.pendingResize == nil {
		return
	}

	cols := rm.pendingResize.Cols
	rows := rm.pendingResize.Rows
	rm.pendingResize = nil

	// Update current dimensions
	rm.currentCols = cols
	rm.currentRows = rows

	// Send to K8s
	if err := rm.executor.SendResize(cols, rows); err != nil {
		// Log error but don't fail - resize is not critical
		// The logger would be accessed via the executor
	}
}

// ImmediateResize sends a resize immediately without debouncing
// Use this for the initial resize when connection is established
func (rm *ResizeManager) ImmediateResize(cols, rows uint16) error {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	// Cancel any pending resize
	if rm.debounceTimer != nil {
		rm.debounceTimer.Stop()
	}
	rm.pendingResize = nil

	// Update dimensions
	rm.currentCols = cols
	rm.currentRows = rows

	return rm.executor.SendResize(cols, rows)
}

// GetDimensions returns the current terminal dimensions
func (rm *ResizeManager) GetDimensions() (cols, rows uint16) {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()
	return rm.currentCols, rm.currentRows
}

// SetDimensions updates the tracked dimensions without sending to K8s
// Use this to sync with the actual terminal state
func (rm *ResizeManager) SetDimensions(cols, rows uint16) {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()
	rm.currentCols = cols
	rm.currentRows = rows
}

// Close stops any pending resize timers
func (rm *ResizeManager) Close() {
	rm.mutex.Lock()
	defer rm.mutex.Unlock()

	if rm.debounceTimer != nil {
		rm.debounceTimer.Stop()
		rm.debounceTimer = nil
	}
	rm.pendingResize = nil
}

// DefaultTerminalDimensions returns standard terminal dimensions
func DefaultTerminalDimensions() (cols, rows uint16) {
	return 120, 30
}

// ValidateDimensions ensures dimensions are within reasonable bounds
func ValidateDimensions(cols, rows uint16) (validCols, validRows uint16) {
	// Minimum dimensions
	const minCols, minRows = 20, 5
	// Maximum dimensions
	const maxCols, maxRows = 500, 200

	validCols = cols
	validRows = rows

	if validCols < minCols {
		validCols = minCols
	} else if validCols > maxCols {
		validCols = maxCols
	}

	if validRows < minRows {
		validRows = minRows
	} else if validRows > maxRows {
		validRows = maxRows
	}

	return validCols, validRows
}
