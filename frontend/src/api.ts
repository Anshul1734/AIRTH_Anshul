import type { Job, JobStatus } from './types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });

  if (!res.ok) {
    let message = `Request failed with status ${res.status}`;
    try {
      const body = await res.json();
      message = Array.isArray(body.message) ? body.message.join(', ') : body.message || message;
    } catch {
      // response had no JSON body
    }
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export function fetchJobs(status?: JobStatus): Promise<Job[]> {
  const query = status ? `?status=${status}` : '';
  return request<Job[]>(`/jobs${query}`);
}

export function createJob(title: string, type: string): Promise<Job> {
  return request<Job>('/jobs', {
    method: 'POST',
    body: JSON.stringify({ title, type }),
  });
}

export function updateJobStatus(id: string, status: JobStatus): Promise<Job> {
  return request<Job>(`/jobs/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

export function deleteJob(id: string): Promise<void> {
  return request<void>(`/jobs/${id}`, { method: 'DELETE' });
}
