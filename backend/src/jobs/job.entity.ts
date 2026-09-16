import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

export enum JobStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Entity('jobs')
export class Job {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  title: string;

  @Column()
  type: string;

  @Column({ type: 'varchar', default: JobStatus.PENDING })
  status: JobStatus;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  // Optional client-supplied key (see Idempotency-Key header on POST /jobs)
  // used to make retried "create job" requests safe to repeat.
  @Column({ name: 'idempotency_key', type: 'varchar', nullable: true, unique: true })
  idempotencyKey: string | null;
}
