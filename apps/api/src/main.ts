import { createServer } from "node:http"
import { mkdirSync } from "node:fs"
import { dirname } from "node:path"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { Config, Effect, ManagedRuntime, Option, Redacted } from "effect"
import { initializeDatabase } from "./repository"
import { makeRequestHandler } from "./server"

const config = await Effect.runPromise(
  Effect.all({
    port: Config.integer("PORT").pipe(Config.withDefault(3001)),
    filename: Config.string("SCORECARD_DB_PATH").pipe(Config.withDefault("./data/scorecard.sqlite")),
    apiKey: Config.redacted("JEV_API_KEY").pipe(Config.option),
  }),
)
const { port, filename } = config
const apiKey = Option.getOrUndefined(config.apiKey)
mkdirSync(dirname(filename), { recursive: true })
const layer = SqliteClient.layer({ filename })
const runtime = ManagedRuntime.make(layer)

await runtime.runPromise(initializeDatabase)

let disposeLive = (): void => {}
const server = createServer(
  makeRequestHandler(runtime, apiKey ? Redacted.value(apiKey) : undefined, undefined, (dispose) => {
    disposeLive = dispose
  }),
)
server.listen(port, "127.0.0.1", () => {
  console.log(`Scorecard API listening on http://127.0.0.1:${port}`)
})

const shutdown = (): void => {
  disposeLive()
  server.close(() => {
    Effect.runPromise(runtime.disposeEffect).finally(() => process.exit(0))
  })
}
process.once("SIGINT", shutdown)
process.once("SIGTERM", shutdown)
