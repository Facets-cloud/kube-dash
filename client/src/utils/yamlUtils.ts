/**
 * YAML utility functions for validation and formatting
 */

export interface YamlValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validates YAML content for Kubernetes resources
 */
export function validateKubernetesYaml(yamlContent: string): YamlValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Basic YAML syntax validation
    const lines = yamlContent.split('\n');
    let hasApiVersion = false;
    let hasKind = false;
    let hasMetadata = false;
    let hasName = false;
    let hasSpec = false;
    let hasStatus = false;
    let lineNumber = 0;

    for (const line of lines) {
      lineNumber++;
      const trimmedLine = line.trim();
      
      // Skip comments and empty lines
      if (trimmedLine.startsWith('#') || trimmedLine === '') {
        continue;
      }

      if (trimmedLine.startsWith('apiVersion:')) {
        hasApiVersion = true;
        // Check if apiVersion has a value
        const value = trimmedLine.substring('apiVersion:'.length).trim();
        if (!value) {
          errors.push(`Line ${lineNumber}: apiVersion is empty`);
        }
      }
      
      if (trimmedLine.startsWith('kind:')) {
        hasKind = true;
        // Check if kind has a value
        const value = trimmedLine.substring('kind:'.length).trim();
        if (!value) {
          errors.push(`Line ${lineNumber}: kind is empty`);
        }
      }
      
      if (trimmedLine.startsWith('metadata:')) {
        hasMetadata = true;
      }
      
      if (trimmedLine.startsWith('name:')) {
        hasName = true;
        // Check if name has a value
        const value = trimmedLine.substring('name:'.length).trim();
        if (!value) {
          errors.push(`Line ${lineNumber}: name is empty`);
        }
      }
      
      if (trimmedLine.startsWith('spec:')) {
        hasSpec = true;
      }
      
      if (trimmedLine.startsWith('status:')) {
        hasStatus = true;
      }
    }

    // Check for required fields
    if (!hasApiVersion) {
      errors.push('Missing required field: apiVersion');
    }
    
    if (!hasKind) {
      errors.push('Missing required field: kind');
    }
    
    if (!hasMetadata) {
      errors.push('Missing required field: metadata');
    }
    
    if (!hasName) {
      errors.push('Missing required field: metadata.name');
    }
    
    // Check for recommended fields
    if (!hasSpec) {
      warnings.push('Missing spec section (may be required for this resource type)');
    }
    
    // Warn about status field in user-provided YAML
    if (hasStatus) {
      warnings.push('Status field detected - this is typically managed by Kubernetes and should not be modified');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  } catch (error) {
    return {
      isValid: false,
      errors: [`Invalid YAML syntax: ${error}`],
      warnings: []
    };
  }
}

/**
 * Formats YAML content with proper indentation
 */
export function formatYaml(yamlContent: string): string {
  try {
    // Parse and re-stringify to ensure proper formatting
    const lines = yamlContent.split('\n');
    const formattedLines: string[] = [];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      if (trimmedLine === '') {
        formattedLines.push('');
        continue;
      }
      
      // Preserve comments
      if (trimmedLine.startsWith('#')) {
        formattedLines.push(line);
        continue;
      }
      
      // Find the original indentation
      const match = line.match(/^(\s*)/);
      const originalIndent = match ? match[1] : '';
      
      // Reconstruct the line with proper indentation
      formattedLines.push(originalIndent + trimmedLine);
    }
    
    return formattedLines.join('\n');
  } catch (error) {
    // If formatting fails, return original content
    return yamlContent;
  }
}

/**
 * Extracts resource information from YAML content
 */
export function extractResourceInfo(yamlContent: string): {
  apiVersion?: string;
  kind?: string;
  name?: string;
  namespace?: string;
} {
  const result: {
    apiVersion?: string;
    kind?: string;
    name?: string;
    namespace?: string;
  } = {};

  try {
    const lines = yamlContent.split('\n');
    let inMetadata = false;

    for (const line of lines) {
      const trimmedLine = line.trim();
      
      if (trimmedLine.startsWith('apiVersion:')) {
        result.apiVersion = trimmedLine.substring('apiVersion:'.length).trim();
      }
      
      if (trimmedLine.startsWith('kind:')) {
        result.kind = trimmedLine.substring('kind:'.length).trim();
      }
      
      if (trimmedLine.startsWith('metadata:')) {
        inMetadata = true;
      }
      
      if (inMetadata && trimmedLine.startsWith('name:')) {
        result.name = trimmedLine.substring('name:'.length).trim();
      }
      
      if (inMetadata && trimmedLine.startsWith('namespace:')) {
        result.namespace = trimmedLine.substring('namespace:'.length).trim();
      }
      
      // Exit metadata section if we encounter a top-level field
      if (inMetadata && !trimmedLine.startsWith(' ') && !trimmedLine.startsWith('\t') && trimmedLine !== '') {
        inMetadata = false;
      }
    }
  } catch (error) {
    // If extraction fails, return empty result
  }

  return result;
}

/**
 * Checks if YAML content has been modified from original
 */
export function hasYamlChanges(original: string, current: string): boolean {
  const normalize = (yaml: string) => yaml.trim().replace(/\r\n/g, '\n');
  return normalize(original) !== normalize(current);
}
