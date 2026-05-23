import "reflect-metadata";
import { join } from "path";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./modules/app.module";

/* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */
const bodyParser: { json: Function; urlencoded: Function } = require("body-parser");
/* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-unsafe-assignment */

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Increase payload limits before NestJS default body parsing kicks in
  app.use(bodyParser.json({ limit: "50mb" }) as Parameters<typeof app.use>[0]);
  app.use(bodyParser.urlencoded({ limit: "50mb", extended: true }) as Parameters<typeof app.use>[0]);
  app.setGlobalPrefix("api");
  app.enableCors({ origin: true, credentials: true });
  app.useStaticAssets(join(process.cwd(), "uploads"), { prefix: "/uploads" });
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );
  await app.listen(process.env.PORT ? Number(process.env.PORT) : 8500);
}

void bootstrap();
