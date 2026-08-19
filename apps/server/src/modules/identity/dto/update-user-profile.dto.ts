import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateUserProfileDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  displayName?: string | null;

  @IsOptional()
  @IsString()
  @IsIn(['en', 'zh-CN'])
  locale?: string | null;
}
