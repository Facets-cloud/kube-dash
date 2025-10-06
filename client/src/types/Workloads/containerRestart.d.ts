export interface ContainerStateInfo {
  state: 'running' | 'waiting' | 'terminated';
  reason?: string;
  message?: string;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
}

export interface ContainerRestartInfo {
  containerName: string;
  restartCount: number;
  lastState?: ContainerStateInfo;
  currentState: ContainerStateInfo;
}
