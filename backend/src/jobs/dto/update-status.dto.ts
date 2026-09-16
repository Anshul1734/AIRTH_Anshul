import { IsIn } from 'class-validator';
import { JobStatus } from '../job.entity';

export class UpdateStatusDto {
  @IsIn(Object.values(JobStatus), {
    message: `status must be one of: ${Object.values(JobStatus).join(', ')}`,
  })
  status: JobStatus;
}
