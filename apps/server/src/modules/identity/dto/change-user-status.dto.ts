import { IsEnum } from 'class-validator';
import { UserStatus } from '../../../generated/prisma/enums';

export class ChangeUserStatusDto {
  @IsEnum(UserStatus)
  status!: UserStatus;
}
