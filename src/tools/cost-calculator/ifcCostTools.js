const LINE_PATTERN = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*)\)\s*;?$/i;

const COST_ELEMENT_TYPES = new Set([
  "IFCBEAM",
  "IFCBUILDINGELEMENTPROXY",
  "IFCCOLUMN",
  "IFCCOVERING",
  "IFCCURTAINWALL",
  "IFCDISTRIBUTIONELEMENT",
  "IFCDOOR",
  "IFCELEMENTASSEMBLY",
  "IFCFOOTING",
  "IFCMEMBER",
  "IFCPILE",
  "IFCPLATE",
  "IFCRAILING",
  "IFCRAMP",
  "IFCROOF",
  "IFCSLAB",
  "IFCSPACE",
  "IFCSTAIR",
  "IFCWALL",
  "IFCWALLSTANDARDCASE",
  "IFCWINDOW",
]);

const QUANTITY_META = {
  IFCQUANTITYAREA: { valueIndex: 3, unit: "m2" },
  IFCQUANTITYCOUNT: { valueIndex: 3, unit: "St" },
  IFCQUANTITYLENGTH: { valueIndex: 3, unit: "m" },
  IFCQUANTITYTIME: { valueIndex: 3, unit: "h" },
  IFCQUANTITYVOLUME: { valueIndex: 3, unit: "m3" },
  IFCQUANTITYWEIGHT: { valueIndex: 3, unit: "kg" },
};

const DEFAULT_RATES = [
  { type: "IFCWALL", unit: "m2", rate: 185 },
  { type: "IFCWALLSTANDARDCASE", unit: "m2", rate: 185 },
  { type: "IFCWALL", unit: "m3", rate: 420 },
  { type: "IFCWALLSTANDARDCASE", unit: "m3", rate: 420 },
  { type: "IFCSLAB", unit: "m2", rate: 120 },
  { type: "IFCSLAB", unit: "m3", rate: 380 },
  { type: "IFCROOF", unit: "m2", rate: 160 },
  { type: "IFCDOOR", unit: "St", rate: 650 },
  { type: "IFCWINDOW", unit: "m2", rate: 480 },
  { type: "IFCWINDOW", unit: "St", rate: 520 },
  { type: "IFCCOLUMN", unit: "m3", rate: 520 },
  { type: "IFCBEAM", unit: "m3", rate: 500 },
  { type: "IFCFOOTING", unit: "m3", rate: 390 },
  { type: "IFCSTAIR", unit: "m2", rate: 350 },
  { type: "IFCCOVERING", unit: "m2", rate: 55 },
  { type: "IFCSPACE", unit: "m2", rate: 0 },
];

export function buildCostAnalysis(text, targetFgk = "300") {
  const { records } = parseIfcLines(text);
  const propertySets = buildPropertySets(records);
  const quantitySets = buildQuantitySets(records);
  const propertiesByElement = new Map();
  const classificationsByElement = new Map();
  const elementsWithQuantities = new Set();
  const quantityRows = [];

  for (const record of records.values()) {
    if (record.type === "IFCRELDEFINESBYPROPERTIES") {
      const relatedElementIds = parseRefList(record.args[4]);
      const definitionId = parseRef(record.args[5]);
      const propertySet = propertySets.get(definitionId);
      const quantitySet = quantitySets.get(definitionId);

      if (propertySet) {
        relatedElementIds.forEach((elementId) => {
          const next = propertiesByElement.get(elementId) || [];
          propertiesByElement.set(elementId, next.concat(propertySet.properties));
        });
      }

      if (quantitySet) {
        relatedElementIds.forEach((elementId) => {
          const element = records.get(elementId);
          if (!isCostElement(element)) return;

          elementsWithQuantities.add(elementId);
          quantitySet.quantities.forEach((quantity) => {
            quantityRows.push(
              makeQuantityRow({
                element,
                quantitySet,
                quantity,
                properties: propertiesByElement.get(elementId) || [],
                classification: classificationsByElement.get(elementId) || "",
              })
            );
          });
        });
      }
    }

    if (record.type === "IFCRELASSOCIATESCLASSIFICATION") {
      const relatedElementIds = parseRefList(record.args[4]);
      const classificationId = parseRef(record.args[5]);
      const classification = parseClassification(records.get(classificationId));
      relatedElementIds.forEach((elementId) => {
        if (classification) classificationsByElement.set(elementId, classification);
      });
    }
  }

  const fallbackRows = [];
  for (const element of records.values()) {
    if (!isCostElement(element) || elementsWithQuantities.has(element.id)) continue;

    fallbackRows.push(
      makeQuantityRow({
        element,
        quantitySet: { id: null, name: "Missing QTO" },
        quantity: {
          id: null,
          name: "ElementCount",
          type: "IFCQUANTITYCOUNT",
          value: 1,
          unit: "St",
          fallback: true,
        },
        properties: propertiesByElement.get(element.id) || [],
        classification: classificationsByElement.get(element.id) || "",
      })
    );
  }

  const rows = quantityRows
    .concat(fallbackRows)
    .map((row) => ({
      ...row,
      costGroup: row.costGroup || extractCostGroup(row.properties, row.classification),
      fgk: row.fgk || extractFgk(row.properties),
      modelRate: row.modelRate ?? extractModelRate(row.properties),
    }))
    .map((row) => ({
      ...row,
      defaultRate: findDefaultRate(row),
      readiness: getReadiness(row, targetFgk),
    }))
    .sort((a, b) => {
      return (
        a.elementType.localeCompare(b.elementType) ||
        String(a.costGroup).localeCompare(String(b.costGroup)) ||
        a.elementId - b.elementId ||
        a.quantityName.localeCompare(b.quantityName)
      );
    });

  return {
    rows,
    summary: summarizeCostRows(rows, targetFgk),
  };
}

export function filterCostRows(rows, filters) {
  const search = normalize(filters.search);
  const entity = normalize(filters.entityType);
  const unit = normalize(filters.unit);
  const costGroup = normalize(filters.costGroup);
  const readiness = filters.readiness || "";

  return rows.filter((row) => {
    const searchable = normalize(
      [
        row.elementId,
        row.elementType,
        row.elementGlobalId,
        row.elementName,
        row.quantitySetName,
        row.quantityName,
        row.costGroup,
        row.classification,
        row.fgk,
      ].join(" ")
    );

    return (
      (!search || searchable.includes(search)) &&
      (!entity || normalize(row.elementType).includes(entity)) &&
      (!unit || normalize(row.unit).includes(unit)) &&
      (!costGroup || normalize(row.costGroup).includes(costGroup)) &&
      (!readiness || row.readiness.level === readiness)
    );
  });
}

export function getRowRate(row, overrides) {
  const override = overrides[row.rowId];
  if (override !== undefined && override !== "") return Number(override) || 0;
  if (row.modelRate !== null && row.modelRate !== undefined) return row.modelRate;
  return row.defaultRate;
}

export function summarizeCosts(rows, overrides) {
  return rows.reduce(
    (summary, row) => {
      const rate = getRowRate(row, overrides);
      const total = row.quantityValue * rate;

      summary.total += Number.isFinite(total) ? total : 0;
      summary.quantity += row.quantityValue;
      summary.items += 1;
      summary.elements.add(row.elementId);
      if (row.fallback) summary.fallbacks += 1;
      if (!row.costGroup) summary.missingCostGroups += 1;
      return summary;
    },
    {
      total: 0,
      quantity: 0,
      items: 0,
      elements: new Set(),
      fallbacks: 0,
      missingCostGroups: 0,
    }
  );
}

export function exportCostRowsCsv(rows, overrides) {
  const header = [
    "ElementId",
    "GlobalId",
    "IFCType",
    "ElementName",
    "CostGroup",
    "Classification",
    "FGK",
    "QuantitySet",
    "QuantityId",
    "QuantityName",
    "Quantity",
    "Unit",
    "UnitRateEUR",
    "TotalEUR",
    "Readiness",
  ];

  const lines = rows.map((row) => {
    const rate = getRowRate(row, overrides);
    return [
      row.elementId,
      row.elementGlobalId,
      row.elementType,
      row.elementName,
      row.costGroup,
      row.classification,
      row.fgk,
      row.quantitySetName,
      row.quantityId || "",
      row.quantityName,
      formatNumber(row.quantityValue),
      row.unit,
      formatNumber(rate),
      formatNumber(row.quantityValue * rate),
      row.readiness.label,
    ]
      .map(csvCell)
      .join(",");
  });

  return [header.join(","), ...lines].join("\n");
}

export function buildCostSnapshot({
  name,
  text,
  targetFgk = "300",
  overrides = {},
}) {
  const analysis = buildCostAnalysis(text, targetFgk);
  const elements = new Map();

  analysis.rows.forEach((row) => {
    const uniqueId = row.elementGlobalId || `#${row.elementId}`;
    const rate = getRowRate(row, overrides);
    const total = row.quantityValue * rate;
    const current = elements.get(uniqueId) || {
      unique_id: uniqueId,
      element_id: row.elementId,
      category: row.elementType,
      family: row.costGroup || row.classification || "Unclassified",
      type: row.elementType,
      level: row.fgk ? `FGK ${row.fgk}` : "FGK not set",
      workset: row.classification || "No classification",
      creator: "",
      last_changed_by: "",
      totalCost: 0,
      quantityCount: 0,
      parameters: {
        "IFC Name": row.elementName || "",
        "GlobalId": row.elementGlobalId || "",
        "Cost Group": row.costGroup || "",
        "Classification": row.classification || "",
        "FGK": row.fgk || "",
      },
    };

    current.totalCost += Number.isFinite(total) ? total : 0;
    current.quantityCount += 1;
    current.parameters[`QTO: ${row.quantitySetName} / ${row.quantityName}`] =
      `${formatNumber(row.quantityValue)} ${row.unit}`;
    current.parameters[`Rate: ${row.quantityName} (${row.unit})`] =
      `${formatNumber(rate)} EUR/${row.unit}`;
    elements.set(uniqueId, current);
  });

  const snapshotElements = Array.from(elements.values()).map((element) => ({
    ...element,
    parameters: {
      ...element.parameters,
      "Quantity Rows": element.quantityCount,
      "Total Cost EUR": formatNumber(element.totalCost),
    },
  }));

  return {
    project_name: name || "IFC model",
    timestamp: new Date().toISOString(),
    elements: snapshotElements,
    rows: analysis.rows,
    summary: analysis.summary,
    totalCost: snapshotElements.reduce((sum, element) => sum + element.totalCost, 0),
  };
}

export function compareCostSnapshots(oldSnapshot, newSnapshot) {
  const oldElements = new Map(
    (oldSnapshot?.elements || []).map((element) => [element.unique_id, element])
  );
  const newElements = new Map(
    (newSnapshot?.elements || []).map((element) => [element.unique_id, element])
  );
  const added = [];
  const deleted = [];
  const modified = [];

  for (const [uniqueId, newElement] of newElements) {
    if (!oldElements.has(uniqueId)) added.push(newElement);
  }

  for (const [uniqueId, oldElement] of oldElements) {
    if (!newElements.has(uniqueId)) deleted.push(oldElement);
  }

  for (const [uniqueId, newElement] of newElements) {
    const oldElement = oldElements.get(uniqueId);
    if (!oldElement) continue;

    const changes = compareElementFields(oldElement, newElement);
    if (changes.length) {
      modified.push({
        ...newElement,
        unique_id: uniqueId,
        changes,
        oldTotalCost: oldElement.totalCost,
        newTotalCost: newElement.totalCost,
        costDelta: newElement.totalCost - oldElement.totalCost,
      });
    }
  }

  const addedCost = added.reduce((sum, element) => sum + element.totalCost, 0);
  const deletedCost = deleted.reduce((sum, element) => sum + element.totalCost, 0);
  const modifiedDelta = modified.reduce((sum, element) => sum + element.costDelta, 0);

  return {
    projectName: newSnapshot?.project_name || oldSnapshot?.project_name || "IFC model",
    oldTimestamp: oldSnapshot?.timestamp || "Baseline",
    newTimestamp: newSnapshot?.timestamp || "Target",
    added,
    deleted,
    modified,
    totals: {
      oldCost: oldSnapshot?.totalCost || 0,
      newCost: newSnapshot?.totalCost || 0,
      delta: (newSnapshot?.totalCost || 0) - (oldSnapshot?.totalCost || 0),
      addedCost,
      deletedCost,
      modifiedDelta,
      netElements: added.length - deleted.length,
    },
  };
}

export function exportCostComparisonCsv(comparison) {
  const header = [
    "Status",
    "GlobalId",
    "ElementId",
    "IFCType",
    "CostGroup",
    "OldCostEUR",
    "NewCostEUR",
    "DeltaEUR",
    "Changes",
  ];

  const lines = [
    ...comparison.added.map((element) =>
      comparisonLine("Added", null, element, element.totalCost, [])
    ),
    ...comparison.deleted.map((element) =>
      comparisonLine("Deleted", element, null, -element.totalCost, [])
    ),
    ...comparison.modified.map((element) =>
      comparisonLine(
        "Modified",
        { ...element, totalCost: element.oldTotalCost },
        element,
        element.costDelta,
        element.changes
      )
    ),
  ];

  return [header.join(","), ...lines].join("\n");
}

function compareElementFields(oldElement, newElement) {
  const changes = [];
  const fields = ["category", "family", "type", "level", "workset"];

  fields.forEach((field) => {
    if ((oldElement[field] || "") !== (newElement[field] || "")) {
      changes.push({
        property: field.charAt(0).toUpperCase() + field.slice(1),
        old: oldElement[field] ?? null,
        new: newElement[field] ?? null,
      });
    }
  });

  const oldParameters = oldElement.parameters || {};
  const newParameters = newElement.parameters || {};
  Object.keys(oldParameters).forEach((name) => {
    if (newParameters[name] === undefined) {
      changes.push({ property: `Param: ${name}`, old: oldParameters[name], new: null });
    } else if (String(oldParameters[name]) !== String(newParameters[name])) {
      changes.push({
        property: `Param: ${name}`,
        old: oldParameters[name],
        new: newParameters[name],
      });
    }
  });
  Object.keys(newParameters).forEach((name) => {
    if (oldParameters[name] === undefined) {
      changes.push({ property: `Param: ${name}`, old: null, new: newParameters[name] });
    }
  });

  return changes;
}

function comparisonLine(status, oldElement, newElement, delta, changes) {
  const element = newElement || oldElement;
  return [
    status,
    element.unique_id,
    element.element_id,
    element.category,
    element.family,
    formatNumber(oldElement?.totalCost || 0),
    formatNumber(newElement?.totalCost || 0),
    formatNumber(delta),
    changes.map((change) => `${change.property}: ${change.old ?? ""} -> ${change.new ?? ""}`).join("; "),
  ]
    .map(csvCell)
    .join(",");
}

function parseIfcLines(text) {
  const records = new Map();

  String(text || "")
    .split(/\r?\n/)
    .forEach((line, index) => {
      const match = line.trim().match(LINE_PATTERN);
      if (!match) return;

      const id = Number(match[1]);
      records.set(id, {
        id,
        type: match[2].toUpperCase(),
        argsText: match[3],
        args: splitTopLevel(match[3]),
        line,
        lineIndex: index,
      });
    });

  return { records };
}

function buildPropertySets(records) {
  const propertySets = new Map();

  for (const record of records.values()) {
    if (record.type !== "IFCPROPERTYSET") continue;

    const propertyIds = parseRefList(record.args[4]);
    const properties = propertyIds
      .map((propertyId) => parseProperty(records.get(propertyId), record))
      .filter(Boolean);

    propertySets.set(record.id, {
      id: record.id,
      name: cleanIfcString(record.args[2]) || `#${record.id}`,
      properties,
    });
  }

  return propertySets;
}

function buildQuantitySets(records) {
  const quantitySets = new Map();

  for (const record of records.values()) {
    if (record.type !== "IFCELEMENTQUANTITY") continue;

    const quantityIds = parseRefList(record.args[5] || record.args[4]);
    const quantities = quantityIds
      .map((quantityId) => parseQuantity(records.get(quantityId)))
      .filter(Boolean);

    quantitySets.set(record.id, {
      id: record.id,
      name: cleanIfcString(record.args[2]) || `#${record.id}`,
      quantities,
    });
  }

  return quantitySets;
}

function parseProperty(record, propertySet) {
  if (!record || record.type !== "IFCPROPERTYSINGLEVALUE") return null;
  const nominal = parseNominalValue(record.args[2]);

  return {
    id: record.id,
    psetId: propertySet.id,
    psetName: cleanIfcString(propertySet.args[2]) || `#${propertySet.id}`,
    name: cleanIfcString(record.args[0]) || `#${record.id}`,
    value: nominal.value,
    display: nominal.display,
    wrapper: nominal.wrapper,
  };
}

function parseQuantity(record) {
  const meta = QUANTITY_META[record?.type];
  if (!record || !meta) return null;

  return {
    id: record.id,
    type: record.type,
    name: cleanIfcString(record.args[0]) || `#${record.id}`,
    value: parseNumber(record.args[meta.valueIndex]),
    unit: meta.unit,
  };
}

function makeQuantityRow({
  element,
  quantitySet,
  quantity,
  properties,
  classification,
}) {
  const globalId = cleanIfcString(element.args[0]);
  const name = cleanIfcString(element.args[2]);
  const costGroup = extractCostGroup(properties, classification);
  const fgk = extractFgk(properties);
  const modelRate = extractModelRate(properties);

  return {
    rowId: `${element.id}-${quantitySet.id || "fallback"}-${quantity.id || quantity.name}`,
    elementId: element.id,
    elementType: element.type,
    elementGlobalId: globalId,
    elementName: name,
    quantitySetId: quantitySet.id,
    quantitySetName: quantitySet.name,
    quantityId: quantity.id,
    quantityName: quantity.name,
    quantityType: quantity.type,
    quantityValue: Number.isFinite(quantity.value) ? quantity.value : 0,
    unit: quantity.unit,
    properties,
    classification,
    costGroup,
    fgk,
    modelRate,
    fallback: Boolean(quantity.fallback),
  };
}

function summarizeCostRows(rows, targetFgk) {
  const elements = new Set(rows.map((row) => row.elementId));
  const quantityElements = new Set(
    rows.filter((row) => !row.fallback).map((row) => row.elementId)
  );
  const classifiedElements = new Set(
    rows.filter((row) => row.costGroup || row.classification).map((row) => row.elementId)
  );
  const fgkElements = new Set(rows.filter((row) => row.fgk).map((row) => row.elementId));
  const readyRows = rows.filter((row) => getReadiness(row, targetFgk).level === "ready");

  return {
    rows: rows.length,
    elements: elements.size,
    quantityElements: quantityElements.size,
    classifiedElements: classifiedElements.size,
    fgkElements: fgkElements.size,
    readyRows: readyRows.length,
    fallbackRows: rows.filter((row) => row.fallback).length,
  };
}

function getReadiness(row, targetFgk) {
  const issues = [];
  if (row.fallback) issues.push("missing explicit quantity");
  if (!row.costGroup && !row.classification) issues.push("missing cost classification");
  if (targetFgk && row.fgk && Number(row.fgk) < Number(targetFgk)) {
    issues.push(`below FGK ${targetFgk}`);
  }

  if (!issues.length) return { level: "ready", label: "Ready" };
  if (issues.length === 1 && issues[0] === "missing cost classification") {
    return { level: "review", label: "Review classification" };
  }
  return { level: "incomplete", label: "Incomplete" };
}

function findDefaultRate(row) {
  const exact = DEFAULT_RATES.find(
    (entry) => entry.type === row.elementType && entry.unit === row.unit
  );
  if (exact) return exact.rate;

  const typeOnly = DEFAULT_RATES.find((entry) => entry.type === row.elementType);
  if (typeOnly) return typeOnly.rate;

  return 0;
}

function extractCostGroup(properties, classification) {
  const classificationText = String(classification || "");
  const dinMatch = classificationText.match(/\b\d{3}(?:\.\d+)?\b/);
  if (dinMatch) return dinMatch[0];

  const hit = properties.find((property) => {
    const key = normalize(`${property.psetName} ${property.name}`);
    return (
      key.includes("kostengruppe") ||
      key.includes("kosten gruppe") ||
      key.includes("din276") ||
      key.includes("din 276") ||
      key.includes("cost group") ||
      key.includes("costgroup")
    );
  });

  return hit?.display || "";
}

function extractFgk(properties) {
  const hit = properties.find((property) => {
    const key = normalize(`${property.psetName} ${property.name}`);
    return key.includes("fgk") || key.includes("fertigstellungsgrad");
  });

  const match = String(hit?.display || "").match(/\d{3}/);
  return match?.[0] || "";
}

function extractModelRate(properties) {
  const hit = properties.find((property) => {
    const key = normalize(`${property.psetName} ${property.name}`);
    return (
      key.includes("einheitspreis") ||
      key.includes("unit cost") ||
      key.includes("unitcost") ||
      key.includes("cost rate") ||
      key.includes("costrate") ||
      key === "rate" ||
      key.endsWith(" preis")
    );
  });

  const value = parseNumber(hit?.display);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseClassification(record) {
  if (!record) return "";
  if (record.type === "IFCCLASSIFICATIONREFERENCE") {
    return [cleanIfcString(record.args[1]), cleanIfcString(record.args[2])]
      .filter(Boolean)
      .join(" ");
  }
  if (record.type === "IFCCLASSIFICATION") {
    return [cleanIfcString(record.args[1]), cleanIfcString(record.args[2])]
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function isCostElement(record) {
  return Boolean(record && COST_ELEMENT_TYPES.has(record.type));
}

function splitTopLevel(input) {
  const parts = [];
  let current = "";
  let depth = 0;
  let inString = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (char === "'") {
      current += char;
      if (inString && next === "'") {
        current += next;
        i += 1;
        continue;
      }
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === "(") depth += 1;
      if (char === ")") depth -= 1;
      if (char === "," && depth === 0) {
        parts.push(current.trim());
        current = "";
        continue;
      }
    }

    current += char;
  }

  if (current.length > 0) parts.push(current.trim());
  return parts;
}

function parseRef(value) {
  const match = String(value || "").match(/#(\d+)/);
  return match ? Number(match[1]) : null;
}

function parseRefList(value) {
  return Array.from(String(value || "").matchAll(/#(\d+)/g), (match) =>
    Number(match[1])
  );
}

function cleanIfcString(value) {
  const text = String(value || "").trim();
  if (!text || text === "$" || text === "*") return "";
  if (!text.startsWith("'")) return text;
  return text.slice(1, -1).replace(/''/g, "'");
}

function parseNominalValue(value) {
  const text = String(value || "$").trim();
  if (text === "$") return { display: "", value: "", wrapper: "$" };

  const typed = text.match(/^([A-Z0-9_]+)\(([\s\S]*)\)$/i);
  if (typed) {
    const display = cleanIfcString(typed[2]);
    return {
      display,
      value: display,
      wrapper: typed[1].toUpperCase(),
    };
  }

  const display = cleanIfcString(text);
  return {
    display,
    value: display,
    wrapper: "",
  };
}

function parseNumber(value) {
  const text = String(value || "").trim();
  const typed = text.match(/^[A-Z0-9_]+\(([\s\S]*)\)$/i);
  const raw = typed ? typed[1] : text;
  const match = String(raw).replace(",", ".").match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/i);
  return match ? Number(match[0]) : NaN;
}

function normalize(value) {
  return String(value || "").trim().toLowerCase();
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}

function csvCell(value) {
  const text = String(value ?? "");
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}
