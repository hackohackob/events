import { Module } from "@nestjs/common";
import { ExampleDataModule } from "../example-data/example-data.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [ExampleDataModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
