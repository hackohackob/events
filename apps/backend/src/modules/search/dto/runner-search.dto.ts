import { IsOptional, IsString } from "class-validator";

export class RunnerSearchDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  bibNumber?: string;
}
