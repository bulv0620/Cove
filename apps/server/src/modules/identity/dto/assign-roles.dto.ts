import { ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class AssignRolesDto {
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  roleIds!: string[];
}
