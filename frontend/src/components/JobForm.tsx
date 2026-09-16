import { useState, type FormEvent } from 'react';

interface Props {
  onCreate: (title: string, type: string) => Promise<void>;
}

export default function JobForm({ onCreate }: Props) {
  const [title, setTitle] = useState('');
  const [type, setType] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!title.trim() || !type.trim()) return;

    setSubmitting(true);
    try {
      await onCreate(title.trim(), type.trim());
      setTitle('');
      setType('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="job-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="Job title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        maxLength={200}
        required
      />
      <input
        type="text"
        placeholder="Job type (e.g. email, report)"
        value={type}
        onChange={(e) => setType(e.target.value)}
        maxLength={100}
        required
      />
      <button type="submit" disabled={submitting}>
        {submitting ? 'Adding...' : 'Add Job'}
      </button>
    </form>
  );
}
