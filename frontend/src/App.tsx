import { useCallback, useEffect, useState } from 'react';
import './App.css';
import { ApiError, createJob, deleteJob, fetchJobs, updateJobStatus } from './api';
import { JOB_STATUSES, type Job, type JobStatus } from './types';
import JobForm from './components/JobForm';
import JobList from './components/JobList';
import StatusCounts from './components/StatusCounts';

type FilterValue = JobStatus | 'all';

function App() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterValue>('all');
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await fetchJobs();
      setJobs(data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Failed to load jobs. Is the API running?');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  function withBusy(id: string, fn: () => Promise<void>) {
    setBusyIds((prev) => new Set(prev).add(id));
    return fn().finally(() => {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    });
  }

  async function handleCreate(title: string, type: string) {
    setActionError(null);
    try {
      const job = await createJob(title, type);
      setJobs((prev) => [job, ...prev]);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Failed to create job.');
    }
  }

  function handleStatusChange(id: string, status: JobStatus) {
    setActionError(null);
    withBusy(id, async () => {
      try {
        const updated = await updateJobStatus(id, status);
        setJobs((prev) => prev.map((j) => (j.id === id ? updated : j)));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Failed to update job status.');
        // Another tab/client may have changed this job already (409) or it
        // may have been deleted (404) — resync from the server so the UI
        // never shows a stale/incorrect status.
        loadJobs();
      }
    });
  }

  function handleDelete(id: string) {
    setActionError(null);
    withBusy(id, async () => {
      try {
        await deleteJob(id);
        setJobs((prev) => prev.filter((j) => j.id !== id));
      } catch (err) {
        setActionError(err instanceof ApiError ? err.message : 'Failed to delete job.');
        loadJobs();
      }
    });
  }

  const visibleJobs = filter === 'all' ? jobs : jobs.filter((j) => j.status === filter);

  return (
    <div className="app">
      <h1>Job Queue Dashboard</h1>

      <StatusCounts jobs={jobs} />

      <JobForm onCreate={handleCreate} />

      {actionError && (
        <div className="banner error">
          {actionError}
          <button className="dismiss" onClick={() => setActionError(null)}>
            &times;
          </button>
        </div>
      )}

      <div className="filter-bar">
        <label htmlFor="status-filter">Filter:</label>
        <select
          id="status-filter"
          value={filter}
          onChange={(e) => setFilter(e.target.value as FilterValue)}
        >
          <option value="all">All</option>
          {JOB_STATUSES.map((status) => (
            <option key={status} value={status}>
              {status}
            </option>
          ))}
        </select>
        <button onClick={loadJobs} disabled={loading}>
          Refresh
        </button>
      </div>

      {loading && <p className="loading-state">Loading jobs...</p>}

      {loadError && (
        <div className="banner error">
          {loadError}
          <button onClick={loadJobs}>Retry</button>
        </div>
      )}

      {!loading && !loadError && (
        <JobList
          jobs={visibleJobs}
          busyIds={busyIds}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

export default App;
