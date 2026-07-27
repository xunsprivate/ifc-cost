import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  applyClassificationMappings,
  applyCostRules,
  buildCostAnalysis,
  createDefaultClassificationMappings,
  createDefaultRateLibrary,
  filterCostRows,
  getRowRate,
  getRowRateSource,
  normalizeRateLibrary,
  summarizeCosts,
} from "./ifcCostTools.js";

const sampleIfcUrl = new URL("../../../sample.ifc", import.meta.url);

test("sample model is reduced to one priced work item per element", async () => {
  const text = await readFile(sampleIfcUrl, "utf8");
  const mappings = createDefaultClassificationMappings();
  const analysis = buildCostAnalysis(text, "300", mappings);
  const mapped = applyClassificationMappings(analysis, mappings, "300");
  const rows = applyCostRules(mapped.rows, createDefaultRateLibrary());
  const summary = summarizeCosts(rows);

  assert.equal(analysis.summary.rows, 18);
  assert.equal(analysis.summary.elements, 4);
  assert.equal(rows.length, 4);
  assert.equal(summary.elements.size, 4);
  assert.equal(summary.excludedQuantities, 14);
  assert.equal(summary.unpriced, 0);
  assert.ok(summary.total > 26_000 && summary.total < 27_000);
});

test("classification mappings derive DIN 276 without replacing IFC metadata", async () => {
  const text = await readFile(sampleIfcUrl, "utf8");
  const mappings = createDefaultClassificationMappings();
  const analysis = buildCostAnalysis(text, "300", []);
  const mapped = applyClassificationMappings(analysis, mappings, "300");
  const row = mapped.rows.find((entry) => entry.classificationCode === "342");

  assert.ok(row);
  assert.equal(row.classificationSystem, "Uniformat");
  assert.equal(row.costGroup, "342");
  assert.match(row.costGroupSource, /^Mapped from Uniformat 342$/);
});

test("IFC model rates remain authoritative without a library match", () => {
  const rows = applyCostRules(
    [
      makeRow({
        elementId: 10,
        elementType: "IFCPLATE",
        modelRate: 42,
        quantityValue: 3,
      }),
    ],
    []
  );

  assert.equal(rows[0].pricingStatus, "priced");
  assert.equal(rows[0].rateRuleLabel, "IFC model rate");
  assert.equal(getRowRate(rows[0]), 42);
  assert.equal(getRowRateSource(rows[0]), "IFC model rate");
  assert.equal(summarizeCosts(rows).total, 126);
  assert.equal(summarizeCosts(rows).unpriced, 0);
});

test("rate rules prefer the requested quantity and never import negative rates", () => {
  const rows = [
    makeRow({
      rowId: "wall-area",
      quantityName: "NetSideArea",
      quantityValue: 12,
    }),
    makeRow({
      rowId: "wall-volume",
      quantityName: "NetVolume",
      quantityValue: 4,
      unit: "m3",
    }),
  ];
  const rateLibrary = normalizeRateLibrary([
    {
      id: "wall-volume-rule",
      label: "Wall by volume",
      elementType: "ifcwall",
      unit: "m3",
      quantityName: "NetVolume",
      rate: -50,
      active: true,
    },
  ]);
  const priced = applyCostRules(rows, rateLibrary);

  assert.equal(rateLibrary[0].rate, 0);
  assert.equal(priced.length, 1);
  assert.equal(priced[0].rowId, "wall-volume");
  assert.equal(priced[0].excludedQuantityCount, 1);
});

test("pricing status filters react to manual rate overrides", () => {
  const rows = applyCostRules([makeRow()], []);
  const filters = {
    search: "",
    level: "",
    entityType: "",
    unit: "",
    costGroup: "",
    quantityName: "",
    pricingStatus: "unpriced",
    readiness: "",
  };

  assert.equal(filterCostRows(rows, filters).length, 1);
  assert.equal(filterCostRows(rows, filters, { "wall-area": "125" }).length, 0);
  assert.equal(
    filterCostRows(rows, { ...filters, pricingStatus: "priced" }, {
      "wall-area": "125",
    }).length,
    1
  );
});

test("fallback count rules price stairs and railings without QTO dimensions", () => {
  const rates = createDefaultRateLibrary();
  const priced = applyCostRules(
    [
      makeRow({
        rowId: "stair-fallback",
        elementId: 20,
        elementType: "IFCSTAIR",
        quantitySetId: null,
        quantitySetName: "Missing QTO",
        quantityId: null,
        quantityName: "ElementCount",
        quantityType: "IFCQUANTITYCOUNT",
        quantityValue: 1,
        unit: "St",
        fallback: true,
      }),
      makeRow({
        rowId: "railing-fallback",
        elementId: 21,
        elementType: "IFCRAILING",
        quantitySetId: null,
        quantitySetName: "Missing QTO",
        quantityId: null,
        quantityName: "ElementCount",
        quantityType: "IFCQUANTITYCOUNT",
        quantityValue: 1,
        unit: "St",
        fallback: true,
      }),
    ],
    rates
  );

  const stair = priced.find((row) => row.elementType === "IFCSTAIR");
  const railing = priced.find((row) => row.elementType === "IFCRAILING");

  assert.equal(stair.rateRuleId, "stair-count-fallback");
  assert.equal(getRowRate(stair), 5000);
  assert.equal(railing.rateRuleId, "railing-count-fallback");
  assert.equal(getRowRate(railing), 2500);
});

test("railing length remains preferred when the IFC provides it", () => {
  const [railing] = applyCostRules(
    [
      makeRow({
        rowId: "railing-length",
        elementId: 22,
        elementType: "IFCRAILING",
        quantityName: "Length",
        quantityType: "IFCQUANTITYLENGTH",
        quantityValue: 8,
        unit: "m",
      }),
    ],
    createDefaultRateLibrary()
  );

  assert.equal(railing.rateRuleId, "railing-length");
  assert.equal(getRowRate(railing), 320);
});

function makeRow(overrides = {}) {
  return {
    rowId: "wall-area",
    elementId: 1,
    elementType: "IFCWALL",
    elementGlobalId: "global-id",
    elementName: "Wall",
    levelId: null,
    level: "Unassigned",
    levelElevation: null,
    quantitySetId: 1,
    quantitySetName: "Qto_WallBaseQuantities",
    quantityId: 2,
    quantityName: "NetSideArea",
    quantityType: "IFCQUANTITYAREA",
    quantityValue: 10,
    unit: "m2",
    properties: [],
    classifications: [],
    classification: "",
    classificationSystem: "",
    classificationCode: "",
    classificationName: "",
    costGroup: "",
    costGroupSource: "",
    costGroupMappingId: "",
    fgk: "",
    modelRate: null,
    fallback: false,
    readiness: { level: "review", label: "Review classification" },
    ...overrides,
  };
}
