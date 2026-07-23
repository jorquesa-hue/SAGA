import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useClient } from "../session.js";
import { useI18n } from "../i18n/index.js";
import { Field, FormMessage, SelectField, useCommand } from "../components/Form.js";

/** Lots & paddock movements (§20): create lots, add animals, move to a paddock. */
export function Lots(): JSX.Element {
  const client = useClient();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [lookupId, setLookupId] = useState("");
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
    }, t("lots.createdMsg"));
  };

  const addAnimals = (): void => {
    const ids = animalIds
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    void add.run(() => client.lots.addAnimals(addLotId, ids), t("lots.addedMsg", { n: ids.length }));
  };

  const moveLot = (): void => {
    void move.run(() => client.lots.move({ lotId: moveLotId, paddockId }), t("lots.movedMsg"));
  };

  return (
    <section>
      <div className="page-head">
        <h2>{t("lots.title")}</h2>
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (lookupId.trim()) navigate(`/lots/${lookupId.trim()}`);
          }}
        >
          <input value={lookupId} onChange={(e) => setLookupId(e.target.value)} placeholder={t("lots.lookupPlaceholder")} style={{ minWidth: 220 }} />
          <button type="submit" disabled={!lookupId.trim()}>
            {t("lots.open")}
          </button>
        </form>
      </div>

      <div className="form">
        <h3>{t("lots.createTitle")}</h3>
        <Field label={t("lots.farmId")} value={farmId} onChange={setFarmId} />
        <Field label={t("lots.name")} value={name} onChange={setName} placeholder={t("lots.namePlaceholder")} />
        <SelectField
          label={t("lots.purpose")}
          value={purpose}
          onChange={setPurpose}
          options={[
            { value: "beef", label: t("lots.purposeBeef") },
            { value: "genetic_nucleus", label: t("lots.purposeGenetic") },
            { value: "rearing", label: t("lots.purposeRearing") },
            { value: "quarantine", label: t("lots.purposeQuarantine") },
          ]}
        />
        <button type="button" disabled={create.busy || !farmId || !name} onClick={createLot}>
          {t("lots.create")}
        </button>
        <FormMessage state={create} />
        {lastLotId && (
          <p className="hint">
            {t("lots.lotLabel")} <Link to={`/lots/${lastLotId}`}>{lastLotId}</Link>
          </p>
        )}
      </div>

      <div className="form">
        <h3>{t("lots.addTitle")}</h3>
        <Field label={t("lots.lotId")} value={addLotId} onChange={setAddLotId} />
        <Field label={t("lots.animalIds")} value={animalIds} onChange={setAnimalIds} />
        <button type="button" disabled={add.busy || !addLotId || !animalIds} onClick={addAnimals}>
          {t("lots.add")}
        </button>
        <FormMessage state={add} />
      </div>

      <div className="form">
        <h3>{t("lots.moveTitle")}</h3>
        <Field label={t("lots.lotId")} value={moveLotId} onChange={setMoveLotId} />
        <Field label={t("lots.paddockId")} value={paddockId} onChange={setPaddockId} />
        <button type="button" disabled={move.busy || !moveLotId || !paddockId} onClick={moveLot}>
          {t("lots.move")}
        </button>
        <FormMessage state={move} />
      </div>
    </section>
  );
}
