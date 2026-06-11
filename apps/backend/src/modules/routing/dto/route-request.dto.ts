import { ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, Max, Min } from "class-validator";
import type { LngLat, RouteProfile } from "../routing.types";

const PROFILES: RouteProfile[] = ["foot", "mtb", "car", "rescue_4x4"];

export class RouteRequestDto {
  @IsIn(PROFILES)
  profile!: RouteProfile;

  /**
   * Ordered waypoints as `[lng, lat]` pairs. First is the start, last is the
   * destination; any in between are via-points from route editing.
   */
  @IsArray()
  @ArrayMinSize(2)
  points!: LngLat[];

  /** How many route variants to return (1–4). Defaults to 3. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  alternatives?: number;
}
