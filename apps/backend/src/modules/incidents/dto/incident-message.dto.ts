import { SendIncidentMessageRequest } from "@events/contracts";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class SendIncidentMessageDto implements SendIncidentMessageRequest {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;
}
