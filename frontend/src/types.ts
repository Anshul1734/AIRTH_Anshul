export type JobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface Job {
  id: string;
  title: string;
  type: string;
  status: JobStatus;
  createdAt: string;
}

export const JOB_STATUSES: JobStatus[] = ['pending', 'running', 'completed', 'failed'];

export const NEXT_STATUSES: Record<JobStatus, JobStatus[]> = {
  pending: ['running'],
  running: ['completed', 'failed'],
  completed: [],
  failed: [],
};
