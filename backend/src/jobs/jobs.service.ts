import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Job, JobStatus } from './job.entity';
import { CreateJobDto } from './dto/create-job.dto';

// Single source of truth for the state machine. Enforced here on the server
// regardless of what the frontend sends, since clients cannot be trusted.
const ALLOWED_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  [JobStatus.PENDING]: [JobStatus.RUNNING],
  [JobStatus.RUNNING]: [JobStatus.COMPLETED, JobStatus.FAILED],
  [JobStatus.COMPLETED]: [],
  [JobStatus.FAILED]: [],
};

@Injectable()
export class JobsService {
  constructor(
    @InjectRepository(Job) private readonly jobsRepo: Repository<Job>,
  ) {}

  async create(dto: CreateJobDto, idempotencyKey?: string): Promise<Job> {
    if (idempotencyKey) {
      const existing = await this.jobsRepo.findOneBy({ idempotencyKey });
      if (existing) return existing;
    }

    const job = this.jobsRepo.create({
      title: dto.title,
      type: dto.type,
      status: JobStatus.PENDING,
      idempotencyKey: idempotencyKey ?? null,
    });

    try {
      return await this.jobsRepo.save(job);
    } catch (err) {
      // Two requests with the same Idempotency-Key raced each other; the
      // unique index rejected the loser. Return the winner's row instead of
      // failing the request or creating a duplicate job.
      if (idempotencyKey && err instanceof QueryFailedError) {
        const existing = await this.jobsRepo.findOneBy({ idempotencyKey });
        if (existing) return existing;
      }
      throw err;
    }
  }

  findAll(status?: JobStatus): Promise<Job[]> {
    return this.jobsRepo.find({
      where: status ? { status } : {},
      order: { createdAt: 'DESC' },
    });
  }

  async remove(id: string): Promise<void> {
    const result = await this.jobsRepo.delete(id);
    if (result.affected === 0) {
      throw new NotFoundException(`Job ${id} not found`);
    }
  }

  async updateStatus(id: string, newStatus: JobStatus): Promise<Job> {
    const job = await this.jobsRepo.findOneBy({ id });
    if (!job) {
      throw new NotFoundException(`Job ${id} not found`);
    }

    const allowedNext = ALLOWED_TRANSITIONS[job.status] ?? [];
    if (!allowedNext.includes(newStatus)) {
      throw new UnprocessableEntityException(
        `Invalid transition from '${job.status}' to '${newStatus}'`,
      );
    }

    // Atomic compare-and-swap: only update if the status is still what we
    // just read. If a concurrent request (e.g. a second browser tab) already
    // moved this job, `affected` comes back 0 and we surface a 409 instead
    // of silently double-applying the transition. This closes the race
    // window between the read above and the write below without needing
    // row locks or a distributed lock manager.
    const result = await this.jobsRepo
      .createQueryBuilder()
      .update(Job)
      .set({ status: newStatus })
      .where('id = :id', { id })
      .andWhere('status = :expected', { expected: job.status })
      .execute();

    if (result.affected === 0) {
      throw new ConflictException(
        `Job was already updated by another request. Current status is no longer '${job.status}'; refresh and try again.`,
      );
    }

    return this.jobsRepo.findOneByOrFail({ id });
  }
}
