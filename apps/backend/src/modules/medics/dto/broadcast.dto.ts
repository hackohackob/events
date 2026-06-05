import { BroadcastRequest } from "@events/contracts";
import { IsNotEmpty, IsString } from "class-validator";

export class BroadcastDto implements BroadcastRequest {
  @IsString()
  @IsNotEmpty()
  title!: string;

  @IsString()
  @IsNotEmpty()
  body!: string;
}
