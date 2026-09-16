import { JOB_STATUSES, type Job } from '../types';

interface Props {
  jobs: Job[];
}

export default function StatusCounts({ jobs }: Props) {
  const counts = JOB_STATUSES.reduce<Record<string, number>>((acc, status) => {
    acc[status] = jobs.filter((j) => j.status === status).length;
    return acc;
  }, {});

  return (
    <div className="status-counts">
      {JOB_STATUSES.map((status) => (
        <div key={status} className={`count-card status-${status}`}>
          <span className="count-value">{counts[status]}</span>
          <span className="count-label">{status}</span>
        </div>
      ))}
      <div className="count-card status-total">
        <span className="count-value">{jobs.length}</span>
        <span className="count-label">total</span>
      </div>
    </div>
  );
}
