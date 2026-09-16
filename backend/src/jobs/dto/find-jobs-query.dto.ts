import { IsIn, IsOptional } from 'class-validator';
import { JobStatus } from '../job.entity';

export class FindJobsQueryDto {
  @IsOptional()
  @IsIn(Object.values(JobStatus), {
    message: `status must be one of: ${Object.values(JobStatus).join(', ')}`,
  })
  status?: JobStatus;
}
