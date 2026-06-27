import { RegisterParticipantRequest } from "@events/contracts";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class RegisterParticipantDto implements RegisterParticipantRequest {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  bibNumber?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsString()
  @IsOptional()
  trackId?: string;

  @IsString()
  @IsOptional()
  trackLabel?: string;

  @IsString()
  @IsOptional()
  allergies?: string;

  @IsString()
  @IsOptional()
  medications?: string;

  @IsString()
  @IsOptional()
  bloodType?: string;

  @IsString()
  @IsOptional()
  conditions?: string;
}
