import { NEXT_STATUSES, type Job, type JobStatus } from '../types';

interface Props {
  job: Job;
  busy: boolean;
  onStatusChange: (id: string, status: JobStatus) => void;
  onDelete: (id: string) => void;
}

export default function JobRow({ job, busy, onStatusChange, onDelete }: Props) {
  const nextStatuses = NEXT_STATUSES[job.status];

  return (
    <tr className={busy ? 'row-busy' : ''}>
      <td>{job.title}</td>
      <td>{job.type}</td>
      <td>
        <span className={`badge status-${job.status}`}>{job.status}</span>
      </td>
      <td>{new Date(job.createdAt).toLocaleString()}</td>
      <td className="actions">
        {nextStatuses.length === 0 ? (
          <span className="muted">no actions</span>
        ) : (
          nextStatuses.map((next) => (
            <button
              key={next}
              disabled={busy}
              onClick={() => onStatusChange(job.id, next)}
            >
              Mark {next}
            </button>
          ))
        )}
        <button disabled={busy} className="danger" onClick={() => onDelete(job.id)}>
          Delete
        </button>
      </td>
    </tr>
  );
}
