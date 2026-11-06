import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ApiErrorIssueDto {
  @ApiProperty({ description: 'Dotted path of the invalid field' })
  path: string;
  @ApiProperty()
  message: string;
}

/**
 * Error body shared by every 4xx answer. `code` is present when the failure
 * has a stable, machine-readable cause (for example `PASSWORD_CHANGE_REQUIRED`).
 */
export class ApiErrorDto {
  @ApiProperty({ example: 400 })
  statusCode: number;
  @ApiProperty()
  message: string;
  @ApiPropertyOptional({ description: 'HTTP reason phrase added by Nest' })
  error?: string;
  @ApiPropertyOptional({ description: 'Stable error code, when there is one' })
  code?: string;
  @ApiPropertyOptional({ type: [ApiErrorIssueDto] })
  issues?: ApiErrorIssueDto[];
}
