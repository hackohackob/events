import { Module } from "@nestjs/common";
import { FieldGuideController } from "./field-guide.controller";
import { FieldGuideService } from "./field-guide.service";

@Module({
  controllers: [FieldGuideController],
  providers: [FieldGuideService],
})
export class FieldGuideModule {}
