import type { Job, JobStatus } from '../types';
import JobRow from './JobRow';

interface Props {
  jobs: Job[];
  busyIds: Set<string>;
  onStatusChange: (id: string, status: JobStatus) => void;
  onDelete: (id: string) => void;
}

export default function JobList({ jobs, busyIds, onStatusChange, onDelete }: Props) {
  if (jobs.length === 0) {
    return <p className="empty-state">No jobs match this filter.</p>;
  }

  return (
    <table className="job-table">
      <thead>
        <tr>
          <th>Title</th>
          <th>Type</th>
          <th>Status</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            busy={busyIds.has(job.id)}
            onStatusChange={onStatusChange}
            onDelete={onDelete}
          />
        ))}
      </tbody>
    </table>
  );
}
