import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import type { ResourceModuleCode } from '@cove/shared';

const RESOURCE_MODULE_CODES: ResourceModuleCode[] = ['identity', 'infrastructure', 'system'];

export class CreateResourceDto {
  @IsString()
  @IsIn(RESOURCE_MODULE_CODES)
  module!: ResourceModuleCode;

  @IsString()
  @Matches(/^[a-z][a-z0-9_]{1,63}$/)
  key!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  description?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  icon?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  sortOrder?: number;
}
