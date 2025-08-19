import { BearerTokenConfig, CertificateConfig, KubeconfigFileConfig } from "@/types";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { KUBECONFIGS_BEARER_URL, KUBECONFIGS_CERTIFICATE_URL, KUBECONFIGS_VALIDATE_BEARER_URL, KUBECONFIGS_VALIDATE_CERTIFICATE_URL } from "@/constants";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { addConfig, resetAddConfig } from "@/data/KwClusters/AddConfigSlice";
import { validateConfig, resetValidateConfig } from "@/data/KwClusters/ValidateConfigSlice";
import { useAppDispatch, useAppSelector } from "@/redux/hooks";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PlusCircledIcon, CheckCircledIcon, ReloadIcon, ArrowUpIcon } from "@radix-ui/react-icons";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { fetchClusters } from "@/data/KwClusters/ClustersSlice";
import { toast } from "sonner";


interface FileValidationStatus {
  filename: string;
  status: 'pending' | 'validating' | 'passed' | 'failed' | 'uploading' | 'uploaded';
  message?: string;
  error?: string;
  configId?: string;
  file: File;
  content?: string;
}

interface ValidationProgress {
  total: number;
  completed: number;
  phase: 'validation' | 'upload' | 'complete';
}

const AddConfig = () => {

  const [textValue, setTextValue] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [bearerTokenConfig, setBearerTokenConfig] = useState<BearerTokenConfig>({} as BearerTokenConfig);
  const [certificateConfig, setCertificateConfig] = useState<CertificateConfig>({} as CertificateConfig);
  const [kubeconfigFileConfig, setKubeconfigFileConfig] = useState<KubeconfigFileConfig>({} as KubeconfigFileConfig);
  const [activeTab, setActiveTab] = useState("bearerToken");
  const [validationPerformed, setValidationPerformed] = useState(false);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [fileValidationStatuses, setFileValidationStatuses] = useState<FileValidationStatus[]>([]);
  const [validationProgress, setValidationProgress] = useState<ValidationProgress>({ total: 0, completed: 0, phase: 'validation' });
  const [isUploading, setIsUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const dispatch = useAppDispatch();
  
  const {
    addConfigResponse,
    error
  } = useAppSelector((state) => state.addConfig);

  const {
    validationResponse,
    error: validationError,
    loading: validationLoading
  } = useAppSelector((state) => state.validateConfig);

  useEffect(() => {
    if (error) {
      toast.error("Failure", {
        description: error.message,
      });
      dispatch(fetchClusters());
      dispatch(resetAddConfig());
      setStatesToDefault(false);
    } else if (addConfigResponse.message) {
      toast.success("Success", {
        description: addConfigResponse.message,
      });
      dispatch(fetchClusters());
      dispatch(resetAddConfig());
      setStatesToDefault(false);
    }
  }, [addConfigResponse, error, dispatch]);

  useEffect(() => {
    if (validationError) {
      toast.error("Validation Failed", {
        description: validationError.error,
      });
      dispatch(resetValidateConfig());
    }
  }, [validationError, dispatch]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setSelectedFiles(files);
    
    // Initialize validation statuses for all files
    const initialStatuses: FileValidationStatus[] = files.map(file => ({
      filename: file.name,
      status: 'pending',
      file: file
    }));
    setFileValidationStatuses(initialStatuses);
    setValidationProgress({ total: files.length, completed: 0, phase: 'validation' });
    
    // If only one file is selected, also populate the text area for validation
    if (files.length === 1) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = (e) => {
        const fileContent = e?.target?.result;
        setTextValue(fileContent?.toString() || '');
        setKubeconfigFileConfig({ ...kubeconfigFileConfig, config: fileContent?.toString() || '' });
        setValidationPerformed(false);
      };
      reader.readAsText(file);
    } else {
      // Clear text area for multiple files
      setTextValue('');
      setKubeconfigFileConfig({ ...kubeconfigFileConfig, config: '' });
      setValidationPerformed(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    
    const files = Array.from(e.dataTransfer.files).filter(file => 
      file.name.endsWith('.yaml') || 
      file.name.endsWith('.yml') || 
      file.name.endsWith('.kubeconfig') ||
      file.name.endsWith('-kubeconfig')
    );
    
    if (files.length > 0) {
      setSelectedFiles(files);
      
      // Initialize validation statuses for all files
      const initialStatuses: FileValidationStatus[] = files.map(file => ({
        filename: file.name,
        status: 'pending',
        file: file
      }));
      setFileValidationStatuses(initialStatuses);
      setValidationProgress({ total: files.length, completed: 0, phase: 'validation' });
      
      // If only one file is selected, also populate the text area for validation
      if (files.length === 1) {
        const file = files[0];
        const reader = new FileReader();
        reader.onload = (e) => {
          const fileContent = e?.target?.result;
          setTextValue(fileContent?.toString() || '');
          setKubeconfigFileConfig({ ...kubeconfigFileConfig, config: fileContent?.toString() || '' });
          setValidationPerformed(false);
        };
        reader.readAsText(file);
      } else {
        // Clear text area for multiple files
        setTextValue('');
        setKubeconfigFileConfig({ ...kubeconfigFileConfig, config: '' });
        setValidationPerformed(false);
      }
    }
  };



  const setStatesToDefault = (open: boolean) => {
    setBearerTokenConfig({} as BearerTokenConfig);
    setCertificateConfig({} as CertificateConfig);
    setKubeconfigFileConfig({} as KubeconfigFileConfig);
    setTextValue('');
    setValidationPerformed(false);
    setSelectedFiles([]);
    setFileValidationStatuses([]);
    setValidationProgress({ total: 0, completed: 0, phase: 'validation' });
    setIsUploading(false);
    setIsDragOver(false);
    setModalOpen(open);
    dispatch(resetValidateConfig());
  };



  const validateBearerToken = () => {
    if (!bearerTokenConfig.apiServer || !bearerTokenConfig.name || !bearerTokenConfig.token) {
      toast.error("Please fill in all required fields for bearer token validation");
      return;
    }

    const formData = new FormData();
    formData.append("name", bearerTokenConfig.name);
    formData.append("serverIP", bearerTokenConfig.apiServer);
    formData.append("token", bearerTokenConfig.token);
    
    dispatch(validateConfig({ formData, url: KUBECONFIGS_VALIDATE_BEARER_URL }));
    setValidationPerformed(true);
  };

  const validateCertificate = () => {
    if (!certificateConfig.apiServer || !certificateConfig.name || !certificateConfig.certificate || !certificateConfig.certificateKey) {
      toast.error("Please fill in all required fields for certificate validation");
      return;
    }

    const formData = new FormData();
    formData.append("name", certificateConfig.name);
    formData.append("serverIP", certificateConfig.apiServer);
    formData.append("clientCertData", certificateConfig.certificate);
    formData.append("clientKeyData", certificateConfig.certificateKey);
    
    dispatch(validateConfig({ formData, url: KUBECONFIGS_VALIDATE_CERTIFICATE_URL }));
    setValidationPerformed(true);
  };

  const updateFileStatus = (filename: string, updates: Partial<FileValidationStatus>) => {
    setFileValidationStatuses(prev => 
      prev.map(status => 
        status.filename === filename 
          ? { ...status, ...updates }
          : status
      )
    );
  };



  const validateSingleFile = async (file: File): Promise<{ file: File; status: 'passed' | 'failed'; content?: string; message: string; error?: string }> => {
    try {
      // Update status to validating
      updateFileStatus(file.name, { status: 'validating', message: 'Reading file...' });
      
      const fileContent = await readFileAsText(file);
      
      // Update status with file content
      updateFileStatus(file.name, { 
        content: fileContent, 
        message: 'Validating kubeconfig...' 
      });
      
      // Validate the kubeconfig
      const validateFormData = new FormData();
      validateFormData.append("file", fileContent);
      
      const validateResponse = await fetch(`/api/v1/app/config/validate`, {
        method: 'POST',
        body: validateFormData,
      });

      const validateResult = await validateResponse.json();

      if (validateResponse.ok && validateResult.hasReachableClusters) {
        // Validation passed
        updateFileStatus(file.name, {
          status: 'passed',
          message: 'Validation passed - clusters reachable'
        });
        return {
          file,
          status: 'passed',
          content: fileContent,
          message: 'Validation passed - clusters reachable'
        };
      } else {
        // Validation failed
        const errorMessage = validateResult.error || 'Validation failed - no reachable clusters';
        updateFileStatus(file.name, {
          status: 'failed',
          message: errorMessage,
          error: validateResult.error
        });
        return {
          file,
          status: 'failed',
          message: errorMessage,
          error: validateResult.error
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Validation failed';
      updateFileStatus(file.name, {
        status: 'failed',
        message: errorMessage,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
      return {
        file,
        status: 'failed',
        message: errorMessage,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  };



  const uploadMultipleKubeconfigs = async () => {
    if (selectedFiles.length === 0) {
      toast.error("No files selected");
      return;
    }

    setIsUploading(true);
    setValidationProgress({ total: selectedFiles.length, completed: 0, phase: 'validation' });

    // Step 1: Validate all kubeconfigs concurrently and collect results
    const validationPromises = selectedFiles.map(file => {
      return validateSingleFile(file).finally(() => {
        setValidationProgress(prev => ({
          ...prev,
          completed: prev.completed + 1
        }));
      });
    });

    const validationResults = await Promise.all(validationPromises);

    // Separate valid and failed files based on actual results
    const validFiles = validationResults.filter(result => result.status === 'passed');
    const failedFiles = validationResults.filter(result => result.status === 'failed');

    // Automatically remove failed files from the list
    if (failedFiles.length > 0) {
      const failedFilenames = failedFiles.map(f => f.file.name);
      setSelectedFiles(prev => prev.filter(file => !failedFilenames.includes(file.name)));
      setFileValidationStatuses(prev => prev.filter(status => !failedFilenames.includes(status.filename)));
      
      toast.error(`${failedFiles.length} kubeconfig${failedFiles.length > 1 ? 's' : ''} failed validation and were removed`);
    }

    if (validFiles.length === 0) {
      setIsUploading(false);
      toast.error("No valid kubeconfigs to upload");
      return;
    }

    // Step 2: Upload only valid kubeconfigs concurrently
    setValidationProgress({ 
      total: validFiles.length, 
      completed: 0, 
      phase: 'upload' 
    });

    const uploadPromises = validFiles.map(validFile => {
      return uploadSingleFileFromResult(validFile as { file: File; status: 'passed'; content?: string; message: string }).finally(() => {
        setValidationProgress(prev => ({
          ...prev,
          completed: prev.completed + 1
        }));
      });
    });

    await Promise.all(uploadPromises);

    // Update final progress
    setValidationProgress(prev => ({ ...prev, phase: 'complete' }));
    setIsUploading(false);

    // Count successful uploads by checking the current state
    const successCount = validFiles.length; // All valid files should have been uploaded
    
    if (successCount > 0) {
      toast.success(`Successfully uploaded ${successCount} kubeconfig${successCount > 1 ? 's' : ''}`);
      
      // Auto-close dialog after successful upload
      setTimeout(() => {
        setStatesToDefault(false);
      }, 500); // Close after 0.5 seconds to let user see the success message
    }

    // Refresh clusters list
    dispatch(fetchClusters());
  };

  const uploadSingleFileFromResult = async (validationResult: { file: File; status: 'passed'; content?: string; message: string }): Promise<void> => {
    if (!validationResult.content) return;
    
    try {
      updateFileStatus(validationResult.file.name, { 
        status: 'uploading', 
        message: 'Uploading to server...' 
      });
      
      const formData = new FormData();
      formData.append("file", validationResult.content);
      formData.append("filename", validationResult.file.name);

      const response = await fetch(`/api/v1/app/config/kubeconfigs`, {
        method: 'POST',
        body: formData,
      });

      const result = await response.json();

      if (response.ok) {
        updateFileStatus(validationResult.file.name, {
          status: 'uploaded',
          message: result.message || 'Upload successful',
          configId: result.id
        });
      } else {
        updateFileStatus(validationResult.file.name, {
          status: 'failed',
          message: result.error || 'Upload failed',
          error: result.error
        });
      }
    } catch (error) {
      updateFileStatus(validationResult.file.name, {
        status: 'failed',
        message: error instanceof Error ? error.message : 'Upload failed',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  };

  const uploadSingleKubeconfig = async () => {
    if (selectedFiles.length !== 1 || !kubeconfigFileConfig.config) {
      toast.error("No kubeconfig content to upload");
      return;
    }

    setIsUploading(true);
    const file = selectedFiles[0];
    
    // Initialize file status
    setFileValidationStatuses([{
      filename: file.name,
      status: 'pending',
      file: file
    }]);
    setValidationProgress({ total: 1, completed: 0, phase: 'validation' });

    try {
      // Step 1: Validate the kubeconfig
      const validationResult = await validateSingleFile(file);
      setValidationProgress({ total: 1, completed: 1, phase: 'validation' });

      if (validationResult.status === 'failed') {
        setIsUploading(false);
        toast.error(`Validation failed: ${validationResult.message}`);
        return;
      }

      // Step 2: Upload the validated kubeconfig
      setValidationProgress({ total: 1, completed: 0, phase: 'upload' });
      await uploadSingleFileFromResult(validationResult as { file: File; status: 'passed'; content?: string; message: string });
      setValidationProgress({ total: 1, completed: 1, phase: 'complete' });

      setIsUploading(false);
      toast.success("Successfully uploaded kubeconfig");
      
      // Auto-close dialog after successful upload
      setTimeout(() => {
        setStatesToDefault(false);
      }, 500); // Close after 0.5 seconds to let user see the success message

      // Refresh clusters list
      dispatch(fetchClusters());
    } catch (error) {
      setIsUploading(false);
      toast.error(`Upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target?.result as string);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file);
    });
  };

  const addNewConfig = () => {
    let route = '';
    let formData: FormData;
    if (activeTab === 'bearerToken') {
      // For bearer token, check if validation was performed and clusters are reachable
      if (!validationPerformed) {
        toast.error("Please validate the bearer token configuration first");
        return;
      }
      
      if (!validationResponse?.hasReachableClusters) {
        toast.error("Cannot add bearer token configuration: Cluster not reachable");
        return;
      }

      formData = new FormData();
      formData.append("serverIP", bearerTokenConfig.apiServer);
      formData.append("name", bearerTokenConfig.name);
      formData.append("token", bearerTokenConfig.token);
      route = KUBECONFIGS_BEARER_URL;
    } else if (activeTab === 'certificate') {
      // For certificate, check if validation was performed and clusters are reachable
      if (!validationPerformed) {
        toast.error("Please validate the certificate configuration first");
        return;
      }
      
      if (!validationResponse?.hasReachableClusters) {
        toast.error("Cannot add certificate configuration: Cluster not reachable");
        return;
      }

      formData = new FormData();
      formData.append("serverIP", certificateConfig.apiServer);
      formData.append("clientCertData", certificateConfig.certificate);
      formData.append("clientKeyData", certificateConfig.certificateKey);
      formData.append("name", certificateConfig.name);
      route = KUBECONFIGS_CERTIFICATE_URL;
    } else {
      // This should not be reached for kubeconfig files as they now use the unified upload function
      toast.error("Please use the Validate & Upload button for kubeconfig files");
      return;
    }
    dispatch(addConfig({ formData, route }));
  };



  const isAddDisabled = () => {
    if (activeTab === "bearerToken") {
      return !bearerTokenConfig.apiServer || !bearerTokenConfig.name || checkForValidConfigName(bearerTokenConfig.name) || !bearerTokenConfig.token || !validationPerformed || !validationResponse?.hasReachableClusters;
    }
    if (activeTab === "certificate") {
      return !certificateConfig.apiServer || !certificateConfig.certificate || !certificateConfig.certificateKey || !certificateConfig.name || checkForValidConfigName(certificateConfig.name) || !validationPerformed || !validationResponse?.hasReachableClusters;
    }
    // Kubeconfig files now use the unified upload function, so this should always be disabled
    return true;
  };

  const checkForValidConfigName = (name: string) => {
    const regex = /^[a-zA-Z0-9._-]+$/;
    return !regex.test(name);
  };



  return (
    <div className="flex items-center space-x-2">
      <div className="ml-auto">
        <Dialog open={modalOpen} onOpenChange={setStatesToDefault}>
          <DialogTrigger asChild>
            <Button className="gap-0">
              <PlusCircledIcon className="mr-2 h-4 w-4" />
              Add Config
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add Config</DialogTitle>
              <DialogDescription>
              </DialogDescription>
            </DialogHeader>
            <div className="flex items-center space-x-2">
              <div className="grid flex-1 gap-2">
                <Tabs defaultValue={activeTab} onValueChange={(value: string) => setActiveTab(value)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="bearerToken">Bearer Token</TabsTrigger>
                    <TabsTrigger value="certificate">Certificate</TabsTrigger>
                    <TabsTrigger value="kubeconfigFile">Kubeconfig File</TabsTrigger>
                  </TabsList>
                  <TabsContent value="bearerToken">
                    <div className="space-y-1">
                      <Label htmlFor="bearerTokenName">Name</Label>
                      <Input
                        id="bearerTokenName"
                        className="shadow-none"
                        placeholder="Enter config name"
                        value={bearerTokenConfig.name}
                        onChange={(e) => setBearerTokenConfig({ ...bearerTokenConfig, name: e.target.value || '' })}
                      />
                    </div>
                    <div className="space-y-1 mt-2">
                      <Label htmlFor="bearerTokenServer">API Server</Label>
                      <Input
                        id="bearerTokenServer"
                        className="shadow-none"
                        placeholder="https://api.example.com:6443"
                        value={bearerTokenConfig.apiServer}
                        onChange={(e) => setBearerTokenConfig({ ...bearerTokenConfig, apiServer: e.target.value || '' })}
                      />
                    </div>
                    <div className="space-y-1 mt-2">
                      <Label htmlFor="bearerToken">Bearer Token</Label>
                      <Textarea
                        id="bearerToken"
                        rows={6}
                        className="shadow-none"
                        placeholder="Bearer {token}"
                        value={bearerTokenConfig.token}
                        onChange={(e) => setBearerTokenConfig({ ...bearerTokenConfig, token: e.target.value || '' })}
                      />
                    </div>
                    <div className="flex justify-end mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={validateBearerToken}
                        disabled={!bearerTokenConfig.apiServer || !bearerTokenConfig.name || !bearerTokenConfig.token || checkForValidConfigName(bearerTokenConfig.name)}
                        className="gap-2"
                      >
                        {validationLoading ? (
                          <ReloadIcon className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircledIcon className="h-4 w-4" />
                        )}
                        Validate
                      </Button>
                    </div>
                  </TabsContent>
                  <TabsContent value="certificate">
                    <div className="space-y-1">
                      <Label htmlFor="certificateName">Name</Label>
                      <Input
                        id="certificateName"
                        className="shadow-none"
                        placeholder="Enter config name"
                        value={certificateConfig.name}
                        onChange={(e) => setCertificateConfig({ ...certificateConfig, name: e.target.value || '' })}
                      />
                    </div>
                    <div className="space-y-1 mt-2">
                      <Label htmlFor="certificateServer">API Server</Label>
                      <Input
                        id="certificateServer"
                        className="shadow-none"
                        placeholder="https://api.example.com:6443"
                        value={certificateConfig.apiServer}
                        onChange={(e) => setCertificateConfig({ ...certificateConfig, apiServer: e.target.value || '' })}
                      />
                    </div>
                    <div className="space-y-1 mt-2">
                      <Label htmlFor="certificate">Certificate</Label>
                      <Textarea
                        id="certificate"
                        rows={6}
                        placeholder={`----- BEGIN CERTIFICATE -----\r\n----- END CERTIFICATE -----`}
                        className="shadow-none"
                        value={certificateConfig.certificate}
                        onChange={(e) => setCertificateConfig({ ...certificateConfig, certificate: e.target.value || '' })}
                      />
                    </div>
                    <div className="space-y-1 mt-2">
                      <Label htmlFor="certificateKey">Certificate Key</Label>
                      <Textarea
                        id="certificateKey"
                        rows={6}
                        placeholder={`----- BEGIN RSA PRIVATE KEY -----\r\n----- END CERTIFICATE -----`}
                        className="shadow-none"
                        value={certificateConfig.certificateKey}
                        onChange={(e) => setCertificateConfig({ ...certificateConfig, certificateKey: e.target.value || '' })}
                      />
                    </div>
                    <div className="flex justify-end mt-4">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={validateCertificate}
                        disabled={!certificateConfig.apiServer || !certificateConfig.name || !certificateConfig.certificate || !certificateConfig.certificateKey || checkForValidConfigName(certificateConfig.name)}
                        className="gap-2"
                      >
                        {validationLoading ? (
                          <ReloadIcon className="h-4 w-4 animate-spin" />
                        ) : (
                          <CheckCircledIcon className="h-4 w-4" />
                        )}
                        Validate
                      </Button>
                    </div>
                  </TabsContent>
                  <TabsContent value="kubeconfigFile">
                    <div className="space-y-1">
                      <Label htmlFor="kubeconfigFile">Files</Label>
                      <div 
                        className={cn(
                          "border-2 border-dashed rounded-lg p-4 transition-colors",
                          isDragOver 
                            ? "border-blue-500 bg-blue-50 dark:bg-blue-950/20" 
                            : "border-gray-300 dark:border-gray-600"
                        )}
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          <Input
                            id="kubeconfigFile"
                            type='file'
                            multiple
                            accept=".yaml,.yml,.kubeconfig,-kubeconfig"
                            className='shadow-none flex-1'
                            onChange={handleFileChange}
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => document.getElementById('kubeconfigFile')?.click()}
                          >
                            Browse Files
                          </Button>
                          {selectedFiles.length > 0 && (
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              onClick={() => {
                                setSelectedFiles([]);
                                setFileValidationStatuses([]);
                                setValidationProgress({ total: 0, completed: 0, phase: 'validation' });
                                setTextValue('');
                                setKubeconfigFileConfig({ ...kubeconfigFileConfig, config: '' });
                                setValidationPerformed(false);
                              }}
                            >
                              Clear
                            </Button>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Drag and drop kubeconfig files here, or click Browse Files
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Hold Cmd (Mac) or Ctrl (Windows/Linux) to select multiple files
                        </p>
                      </div>
                      {selectedFiles.length > 0 && (
                        <div className="mt-2">
                          <p className="text-sm text-muted-foreground mb-2">
                            Selected {selectedFiles.length} file{selectedFiles.length > 1 ? 's' : ''}:
                          </p>
                          <div className="space-y-1">
                            {selectedFiles.map((file, index) => {
                              const fileStatus = fileValidationStatuses.find(status => status.filename === file.name);
                              return (
                                <div key={index} className="flex items-center gap-2 text-sm">
                                  <span className="text-blue-600">{file.name}</span>
                                  <span className="text-muted-foreground">({(file.size / 1024).toFixed(1)} KB)</span>
                                  {fileStatus && (
                                    <span className="ml-2">
                                      {fileStatus.status === 'pending' && '⏳'}
                                      {fileStatus.status === 'validating' && '🔄'}
                                      {(fileStatus.status === 'passed' || fileStatus.status === 'uploaded') && '✅'}
                                      {fileStatus.status === 'failed' && '❌'}
                                      {fileStatus.status === 'uploading' && '⬆️'}
                                    </span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    
                    {selectedFiles.length === 1 && (
                      <div className="space-y-1 mt-1">
                        <Textarea id="kubeconfig"
                          rows={8}
                          className="shadow-none"
                          placeholder="Select the config file or directly paste your config here"
                          value={textValue}
                          onChange={(e) => {
                            setTextValue(e.target.value || '');
                            setKubeconfigFileConfig({ ...kubeconfigFileConfig, config: e.target.value || '' });
                            setValidationPerformed(false);
                          }}
                        />
                      </div>
                    )}
                    
                    {selectedFiles.length === 1 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-blue-600">{selectedFiles[0].name}</span>
                          <span className="text-muted-foreground">({(selectedFiles[0].size / 1024).toFixed(1)} KB)</span>
                          {fileValidationStatuses.length > 0 && (
                            <span className="ml-2">
                              {fileValidationStatuses[0].status === 'pending' && '⏳'}
                              {fileValidationStatuses[0].status === 'validating' && '🔄'}
                              {(fileValidationStatuses[0].status === 'passed' || fileValidationStatuses[0].status === 'uploaded') && '✅'}
                              {fileValidationStatuses[0].status === 'failed' && '❌'}
                              {fileValidationStatuses[0].status === 'uploading' && '⬆️'}
                            </span>
                          )}
                        </div>
                        {fileValidationStatuses.length > 0 && fileValidationStatuses[0].message && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {fileValidationStatuses[0].message}
                          </p>
                        )}
                      </div>
                    )}
                    
                    {selectedFiles.length === 1 && kubeconfigFileConfig.config && (
                      <div className="mt-4">
                        <Button
                          type="button"
                          onClick={uploadSingleKubeconfig}
                          disabled={isUploading}
                          className="w-full"
                        >
                          {isUploading ? (
                            <>
                              <ReloadIcon className="w-4 h-4 mr-2 animate-spin" />
                              Validating & Uploading...
                            </>
                          ) : (
                            <>
                              <ArrowUpIcon className="w-4 h-4 mr-2" />
                              Validate & Upload Kubeconfig
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                    
                    {selectedFiles.length > 1 && (
                      <div className="mt-4">
                        <Button
                          type="button"
                          onClick={uploadMultipleKubeconfigs}
                          disabled={isUploading}
                          className="w-full"
                        >
                          {isUploading ? (
                            <>
                              <ReloadIcon className="w-4 h-4 mr-2 animate-spin" />
                              Validating & Uploading {selectedFiles.length} files...
                            </>
                          ) : (
                            <>
                              <ArrowUpIcon className="w-4 h-4 mr-2" />
                              Validate & Upload {selectedFiles.length} Kubeconfig{selectedFiles.length > 1 ? 's' : ''}
                            </>
                          )}
                        </Button>
                      </div>
                    )}
                    
                    {/* Progress indicator during validation/upload */}
                    {isUploading && validationProgress.total > 0 && (
                      <div className="mt-4 p-3 border rounded-md bg-blue-50 dark:bg-blue-950/20">
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-sm font-medium">
                            {validationProgress.phase === 'validation' ? 
                              (selectedFiles.length === 1 ? 'Validating Kubeconfig...' : 'Validating Files...') : 
                             validationProgress.phase === 'upload' ? 
                              (selectedFiles.length === 1 ? 'Uploading Kubeconfig...' : 'Uploading Files...') : 'Complete'}
                          </h4>
                          <span className="text-xs text-muted-foreground">
                            {validationProgress.completed} / {validationProgress.total}
                          </span>
                        </div>
                        <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                          <div 
                            className="bg-blue-600 h-2 rounded-full transition-all duration-300" 
                            style={{ width: `${(validationProgress.completed / validationProgress.total) * 100}%` }}
                          />
                        </div>
                      </div>
                    )}

                  </TabsContent>
                </Tabs>
              </div>
            </div>
            <DialogFooter className="sm:flex-col">
              {activeTab !== 'kubeconfigFile' ? (
                <Button
                  type="submit"
                  onClick={addNewConfig}
                  disabled={isAddDisabled()}
                >Save</Button>
              ) : null}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
};

export {
  AddConfig
};