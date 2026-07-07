import { IncidentMessageKind, SendIncidentMessageRequest } from "@events/contracts";
import { IsIn, IsNotEmpty, IsObject, IsOptional, IsString } from "class-validator";

export class SendIncidentMessageDto implements SendIncidentMessageRequest {
  @IsString()
  @IsNotEmpty()
  text!: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  /** Structured kinds logged by the runner's guided-care flow; text stays the
   *  human-readable fallback line. */
  @IsOptional()
  @IsIn(["text", "voice", "first_aid", "cpr", "system"])
  kind?: IncidentMessageKind;

  @IsOptional()
  @IsObject()
  meta?: Record<string, unknown>;
}
