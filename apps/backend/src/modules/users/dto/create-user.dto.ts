import { IsEmail, IsEnum, IsNotEmpty, IsOptional, IsString } from "class-validator";

export type UserRole = "paramedic" | "emt" | "coordinator" | "doctor" | "admin";
export type UserStatus = "active" | "inactive";

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(["paramedic", "emt", "coordinator", "doctor", "admin"])
  role!: UserRole;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsEnum(["active", "inactive"])
  @IsOptional()
  status?: UserStatus;
}

export class UpdateUserDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(["paramedic", "emt", "coordinator", "doctor", "admin"])
  @IsOptional()
  role?: UserRole;

  @IsString()
  @IsOptional()
  unit?: string;

  @IsEnum(["active", "inactive"])
  @IsOptional()
  status?: UserStatus;
}
