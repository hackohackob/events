import { Module } from "@nestjs/common";
import { ExampleDataModule } from "../example-data/example-data.module";
import { UnitsController } from "./units.controller";
import { UnitsService } from "./units.service";

@Module({
  imports: [ExampleDataModule],
  controllers: [UnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}
