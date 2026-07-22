import { SagaService } from "./application/useCases.js";
import { createInMemoryRepositories } from "./infrastructure/persistence/inMemory.js";
import { createApp } from "./infrastructure/http/app.js";

const repos = createInMemoryRepositories();
const service = new SagaService(repos);
const app = createApp(service);

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`SAGA backend listening on http://localhost:${port}`);
});
