import { JoinEventRequest } from "@events/contracts";
import { IsNotEmpty, IsOptional, IsString } from "class-validator";

export class JoinEventDto implements JoinEventRequest {
  @IsString()
  @IsNotEmpty()
  joinCode!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsOptional()
  bibNumber?: string;
}
