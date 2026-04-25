import { Module } from "@nestjs/common";
import { ExampleDataService } from "./example-data.service";

@Module({
  providers: [ExampleDataService],
  exports: [ExampleDataService],
})
export class ExampleDataModule {}
