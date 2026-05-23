import { JoinEventRequest } from "@events/contracts";
import { IsIn, IsNotEmpty, IsOptional, IsString } from "class-validator";

export class JoinEventDto implements JoinEventRequest {
  @IsString()
  @IsNotEmpty()
  joinCode!: string;

  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  bibNumber?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsIn(["runner", "medic"])
  @IsOptional()
  role?: "runner" | "medic";

  @IsString()
  @IsOptional()
  medicId?: string;
}
