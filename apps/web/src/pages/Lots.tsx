import { useState } from "react";
import { useClient } from "../session.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/** Lots & paddock movements (§20): create lots, add animals, move to a paddock. */
export function Lots(): JSX.Element {
  const client = useClient();
  const create = useCommand();
  const add = useCommand();
  const move = useCommand();

  const [farmId, setFarmId] = useState("");
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("beef");
  const [lastLotId, setLastLotId] = useState<string | null>(null);

  const [addLotId, setAddLotId] = useState("");
  const [animalIds, setAnimalIds] = useState("");

  const [moveLotId, setMoveLotId] = useState("");
  const [paddockId, setPaddockId] = useState("");

  const createLot = (): void => {
    void create.run(async () => {
      const lot = await client.lots.create({ farmId, name, purpose });
      const id = String(lot.id ?? lot.lotId ?? "");
      setLastLotId(id);
      setAddLotId(id);
      setMoveLotId(id);
    }, "Lote criado");
  };

  const addAnimals = (): void => {
    const ids = animalIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    void add.run(() => client.lots.addAnimals(addLotId, ids), `${ids.length} animal(is) adicionado(s)`);
  };

  const moveLot = (): void => {
    void move.run(() => client.lots.move({ lotId: moveLotId, paddockId }), "Movimentação registrada");
  };

  return (
    <section>
      <div className="page-head">
        <h2>Lotes e movimentações</h2>
      </div>

      <div className="form">
        <h3>Criar lote</h3>
        <Field label="Fazenda ID" value={farmId} onChange={setFarmId} />
        <Field label="Nome" value={name} onChange={setName} placeholder="ex.: Recria 2026-A" />
        <SelectField
          label="Finalidade"
          value={purpose}
          onChange={setPurpose}
          options={[
            { value: "beef", label: "Corte" },
            { value: "genetic_nucleus", label: "Núcleo genético" },
            { value: "rearing", label: "Recria" },
            { value: "quarantine", label: "Quarentena" },
          ]}
        />
        <button type="button" disabled={create.busy || !farmId || !name} onClick={createLot}>
          Criar
        </button>
        <FormMessage state={create} />
        {lastLotId && <p className="hint">Lote: {lastLotId}</p>}
      </div>

      <div className="form">
        <h3>Adicionar animais ao lote</h3>
        <Field label="Lote ID" value={addLotId} onChange={setAddLotId} />
        <Field label="Animal IDs (separados por vírgula/linha)" value={animalIds} onChange={setAnimalIds} />
        <button type="button" disabled={add.busy || !addLotId || !animalIds} onClick={addAnimals}>
          Adicionar
        </button>
        <FormMessage state={add} />
      </div>

      <div className="form">
        <h3>Mover lote para piquete</h3>
        <Field label="Lote ID" value={moveLotId} onChange={setMoveLotId} />
        <Field label="Piquete ID" value={paddockId} onChange={setPaddockId} />
        <button type="button" disabled={move.busy || !moveLotId || !paddockId} onClick={moveLot}>
          Mover
        </button>
        <FormMessage state={move} />
      </div>
    </section>
  );
}
