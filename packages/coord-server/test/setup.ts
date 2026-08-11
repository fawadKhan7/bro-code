import { Logger } from "@nestjs/common";

// Services log through Nest even when constructed directly in unit tests; that
// noise buries the actual assertion output.
Logger.overrideLogger(false);
